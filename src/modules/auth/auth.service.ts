import crypto from "crypto";
import { query, withTransaction } from "../../db/client.js";
import { redis } from "../../redis/client.js";
import { accountsService } from "../accounts/accounts.service.js";
import { depositsService } from "../deposits/deposits.service.js";
import { emailService } from "./email.service.js";
import { AppError } from "../../common/errors.js";
import { LoginInput, RegisterInput, SendOtpInput, VerifyOtpInput } from "./auth.schema.js";
import { Account } from "../../common/types.js";

export interface UserProfile {
  id: string;
  username: string;
  full_name: string;
  email: string;
  avatar_url: string | null;
  is_email_verified?: boolean;
  auth_provider?: string;
  created_at: Date;
}

export class AuthService {
  private hashPassword(password: string): string {
    const salt = crypto.randomBytes(16).toString("hex");
    const derivedKey = crypto.scryptSync(password, salt, 64).toString("hex");
    return `${salt}:${derivedKey}`;
  }

  private verifyPassword(password: string, stored: string): boolean {
    const [salt, key] = stored.split(":");
    if (!salt || !key) return false;
    const derivedKey = crypto.scryptSync(password, salt, 64).toString("hex");
    return crypto.timingSafeEqual(Buffer.from(key, "hex"), Buffer.from(derivedKey, "hex"));
  }

  /**
   * Dispatches a 6-digit OTP code to the user's Gmail address
   */
  async sendGmailOtp(input: SendOtpInput): Promise<{
    success: boolean;
    email: string;
    message: string;
    dev_otp?: string;
  }> {
    const normalizedEmail = input.email.toLowerCase().trim();

    // 1. Check rate-limit (30 seconds between requests per email)
    const rateKey = `otp:rate:${normalizedEmail}`;
    const isRateLimited = await redis.get(rateKey);
    if (isRateLimited) {
      const ttl = await redis.ttl(rateKey);
      throw new AppError(
        429,
        "RATE_LIMITED",
        `Please wait ${ttl > 0 ? ttl : 30} seconds before requesting another verification code.`
      );
    }

    // 2. Generate cryptographically secure 6-digit OTP
    const otpCode = crypto.randomInt(100000, 999999).toString();

    // 3. Store OTP in Redis with 5 minutes (300s) TTL
    const otpKey = `otp:gmail:${normalizedEmail}`;
    await redis.set(
      otpKey,
      JSON.stringify({
        code: otpCode,
        attempts: 0,
        createdAt: Date.now(),
      }),
      "EX",
      300
    );

    // Set 30s rate limit lock
    await redis.set(rateKey, "1", "EX", 30);

    // 4. Send email via SMTP (or fallback logger)
    const emailResult = await emailService.sendOtpEmail(normalizedEmail, otpCode);

    return {
      success: true,
      email: normalizedEmail,
      message: `Verification code sent to ${normalizedEmail}`,
      dev_otp: emailResult.mode === "mock" ? otpCode : undefined,
    };
  }

  /**
   * Verifies the 6-digit Gmail OTP and activates or signs in the user account
   */
  async verifyGmailOtp(input: VerifyOtpInput): Promise<{
    user: UserProfile;
    wallet: Account;
    is_new: boolean;
  }> {
    const normalizedEmail = input.email.toLowerCase().trim();
    const otpKey = `otp:gmail:${normalizedEmail}`;

    const rawData = await redis.get(otpKey);
    if (!rawData) {
      throw new AppError(
        400,
        "INVALID_OTP",
        "Verification code has expired or was not requested. Please request a new code."
      );
    }

    const record = JSON.parse(rawData) as {
      code: string;
      attempts: number;
      createdAt: number;
    };

    // Max 5 attempts
    if (record.attempts >= 5) {
      await redis.del(otpKey);
      throw new AppError(
        429,
        "TOO_MANY_ATTEMPTS",
        "Maximum verification attempts exceeded. Please request a new code."
      );
    }

    if (record.code !== input.otp.trim()) {
      record.attempts += 1;
      const ttl = await redis.ttl(otpKey);
      if (ttl > 0) {
        await redis.set(otpKey, JSON.stringify(record), "EX", ttl);
      }
      throw new AppError(
        400,
        "INVALID_OTP",
        `Incorrect verification code. ${5 - record.attempts} attempts remaining.`
      );
    }

    // OTP verified successfully -> invalidate immediately
    await redis.del(otpKey);

    // 1. Check if user already exists
    const userRes = await query<UserProfile>(
      `SELECT id, username, full_name, email, avatar_url, is_email_verified, auth_provider, created_at
       FROM users
       WHERE email = $1`,
      [normalizedEmail]
    );

    let user: UserProfile;
    let isNew = false;

    if (userRes.rows.length > 0) {
      // Existing user
      user = userRes.rows[0];
      if (!user.is_email_verified) {
        await query(`UPDATE users SET is_email_verified = TRUE WHERE id = $1`, [user.id]);
        user.is_email_verified = true;
      }
    } else {
      // 2. New user -> Auto-provision profile
      isNew = true;

      // Extract username from email prefix (e.g. john.doe@gmail.com -> john_doe)
      let baseUsername = normalizedEmail.split("@")[0].replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 20);
      if (baseUsername.length < 3) baseUsername = `user_${baseUsername}`;

      // Check if username taken
      const checkU = await query(`SELECT id FROM users WHERE username = $1`, [baseUsername]);
      let finalUsername = baseUsername;
      if (checkU.rows.length > 0) {
        finalUsername = `${baseUsername}_${crypto.randomInt(100, 999)}`;
      }

      // Format clean full name if not provided
      const finalFullName =
        input.full_name?.trim() ||
        baseUsername
          .split("_")
          .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
          .join(" ") ||
        "Vaultkern User";

      const avatarUrl = `https://api.dicebear.com/7.x/avataaars/svg?seed=${finalUsername}`;

      const insertRes = await query<UserProfile>(
        `INSERT INTO users (username, full_name, email, avatar_url, is_email_verified, auth_provider)
         VALUES ($1, $2, $3, $4, TRUE, 'gmail')
         RETURNING id, username, full_name, email, avatar_url, is_email_verified, auth_provider, created_at;`,
        [finalUsername, finalFullName, normalizedEmail, avatarUrl]
      );
      user = insertRes.rows[0];
    }

    // 3. Find or Create Default Wallet
    let walletRes = await query<Account>(
      `SELECT * FROM accounts WHERE user_id = $1 AND type = 'USER_WALLET' ORDER BY created_at ASC LIMIT 1`,
      [user.id]
    );

    let wallet: Account;
    if (walletRes.rows.length === 0) {
      wallet = await accountsService.createAccount({
        user_id: user.id,
        currency: "INR",
      });

      // Credit welcome capital of ₹1,000 (100,000 paise) so user can immediately transact
      try {
        await depositsService.executeDeposit(
          {
            account_id: wallet.id,
            amount: 100000n,
            description: "Welcome sign-up bonus",
          },
          `welcome_bonus_${user.id}`
        );
        wallet = await accountsService.getAccountById(wallet.id);
      } catch (err) {
        console.warn("Could not credit welcome bonus:", err);
      }
    } else {
      wallet = walletRes.rows[0];
    }

    return {
      user,
      wallet,
      is_new: isNew,
    };
  }

  async register(input: RegisterInput): Promise<{
    user: UserProfile;
    wallet: Account;
  }> {
    const normalizedUsername = input.username.toLowerCase().trim();
    const normalizedEmail = input.email.toLowerCase().trim();

    // Check unique username / email
    const existingCheck = await query(
      `SELECT id FROM users WHERE username = $1 OR email = $2`,
      [normalizedUsername, normalizedEmail]
    );

    if (existingCheck.rows.length > 0) {
      throw new AppError(409, "USER_EXISTS", "A user with this username or email already exists");
    }

    const passwordHash = this.hashPassword(input.password);
    const avatarUrl = `https://api.dicebear.com/7.x/avataaars/svg?seed=${normalizedUsername}`;

    // 1. Create User
    const userRes = await query<UserProfile>(
      `INSERT INTO users (username, full_name, email, password_hash, avatar_url, is_email_verified, auth_provider)
       VALUES ($1, $2, $3, $4, $5, FALSE, 'local')
       RETURNING id, username, full_name, email, avatar_url, created_at;`,
      [normalizedUsername, input.full_name, normalizedEmail, passwordHash, avatarUrl]
    );
    const user = userRes.rows[0];

    // 2. Create Default Wallet
    const wallet = await accountsService.createAccount({
      user_id: user.id,
      currency: input.currency || "INR",
    });

    // 3. Credit Welcome Capital of ₹1,000 (100,000 paise)
    try {
      await depositsService.executeDeposit(
        {
          account_id: wallet.id,
          amount: 100000n,
          description: "Welcome sign-up bonus",
        },
        `welcome_bonus_${user.id}`
      );
      const updatedWallet = await accountsService.getAccountById(wallet.id);
      return { user, wallet: updatedWallet };
    } catch {
      return { user, wallet };
    }
  }

  async login(input: LoginInput): Promise<{
    user: UserProfile;
    wallet: Account;
  }> {
    const term = input.login.toLowerCase().trim();

    const userRes = await query<UserProfile & { password_hash: string | null }>(
      `SELECT id, username, full_name, email, password_hash, avatar_url, is_email_verified, auth_provider, created_at
       FROM users 
       WHERE username = $1 OR email = $1`,
      [term]
    );

    if (userRes.rows.length === 0) {
      throw new AppError(401, "INVALID_CREDENTIALS", "Invalid username/email or password");
    }

    const row = userRes.rows[0];
    if (!row.password_hash) {
      throw new AppError(
        400,
        "GMAIL_AUTH_REQUIRED",
        "This account was created via Gmail. Please sign in using your Gmail verification code."
      );
    }

    const passwordValid = this.verifyPassword(input.password, row.password_hash);

    if (!passwordValid) {
      throw new AppError(401, "INVALID_CREDENTIALS", "Invalid username/email or password");
    }

    const { password_hash, ...user } = row;

    // Fetch user's wallet
    let walletRes = await query<Account>(
      `SELECT * FROM accounts WHERE user_id = $1 AND type = 'USER_WALLET' ORDER BY created_at ASC LIMIT 1`,
      [user.id]
    );

    let wallet: Account;
    if (walletRes.rows.length === 0) {
      wallet = await accountsService.createAccount({ user_id: user.id, currency: "INR" });
    } else {
      wallet = walletRes.rows[0];
    }

    return { user, wallet };
  }

  async getUserProfile(userId: string): Promise<{
    user: UserProfile;
    wallet: Account;
  }> {
    const userRes = await query<UserProfile>(
      `SELECT id, username, full_name, email, avatar_url, is_email_verified, auth_provider, created_at FROM users WHERE id = $1`,
      [userId]
    );

    if (userRes.rows.length === 0) {
      throw new AppError(404, "USER_NOT_FOUND", "User not found");
    }

    const user = userRes.rows[0];
    const walletRes = await query<Account>(
      `SELECT * FROM accounts WHERE user_id = $1 AND type = 'USER_WALLET' LIMIT 1`,
      [user.id]
    );

    return { user, wallet: walletRes.rows[0] };
  }

  async searchUsers(queryText: string, excludeUserId?: string): Promise<
    Array<{
      id: string;
      username: string;
      full_name: string;
      avatar_url: string | null;
      wallet_id: string;
      account_number: string;
    }>
  > {
    const q = `%${(queryText || "").toLowerCase()}%`;
    const res = await query<{
      id: string;
      username: string;
      full_name: string;
      avatar_url: string | null;
      wallet_id: string;
      account_number: string;
    }>(
      `SELECT 
         u.id,
         u.username,
         u.full_name,
         u.avatar_url,
         a.id as wallet_id,
         a.account_number
       FROM users u
       JOIN accounts a ON u.id::varchar = a.user_id AND a.type = 'USER_WALLET'
       WHERE (u.username ILIKE $1 OR u.full_name ILIKE $1 OR u.email ILIKE $1)
         AND ($2::text IS NULL OR u.id::text != $2)
       LIMIT 10;`,
      [q, excludeUserId || null]
    );

    return res.rows;
  }
}

export const authService = new AuthService();
