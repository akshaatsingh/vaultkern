import crypto from "crypto";
import { query, withTransaction } from "../../db/client.js";
import { accountsService } from "../accounts/accounts.service.js";
import { depositsService } from "../deposits/deposits.service.js";
import { AppError } from "../../common/errors.js";
import { LoginInput, RegisterInput } from "./auth.schema.js";
import { Account } from "../../common/types.js";

export interface UserProfile {
  id: string;
  username: string;
  full_name: string;
  email: string;
  avatar_url: string | null;
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
      `INSERT INTO users (username, full_name, email, password_hash, avatar_url)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, username, full_name, email, avatar_url, created_at;`,
      [normalizedUsername, input.full_name, normalizedEmail, passwordHash, avatarUrl]
    );
    const user = userRes.rows[0];

    // 2. Create Default Wallet
    const wallet = await accountsService.createAccount({
      user_id: user.id,
      currency: input.currency || "INR",
    });

    // 3. Credit Welcome Capital of ₹1,000 (100,000 paise) so user can test transfers right away!
    try {
      await depositsService.executeDeposit(
        {
          account_id: wallet.id,
          amount: 100000n,
          description: "Welcome sign-up bonus",
        },
        `welcome_bonus_${user.id}`
      );
      // Refresh wallet balance
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

    const userRes = await query<UserProfile & { password_hash: string }>(
      `SELECT id, username, full_name, email, password_hash, avatar_url, created_at
       FROM users 
       WHERE username = $1 OR email = $1`,
      [term]
    );

    if (userRes.rows.length === 0) {
      throw new AppError(401, "INVALID_CREDENTIALS", "Invalid username/email or password");
    }

    const row = userRes.rows[0];
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
      `SELECT id, username, full_name, email, avatar_url, created_at FROM users WHERE id = $1`,
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
