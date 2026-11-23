import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { getTestApp, resetDatabase, closeTestResources } from "../test-helper.js";
import { FastifyInstance } from "fastify";
import { redis } from "../../src/redis/client.js";

describe("Gmail OTP Authentication API", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await getTestApp();
  });

  afterAll(async () => {
    await closeTestResources();
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  it("should reject non-Gmail email addresses", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/send-otp",
      payload: {
        email: "alice@outlook.com",
      },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("should send OTP to a valid Gmail address and return mock OTP in dev mode", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/send-otp",
      payload: {
        email: "alice.fintech@gmail.com",
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.email).toBe("alice.fintech@gmail.com");
    expect(body.data.dev_otp).toBeDefined();
    expect(body.data.dev_otp).toMatch(/^\d{6}$/);

    // Verify Redis has the OTP stored with TTL
    const stored = await redis.get("otp:gmail:alice.fintech@gmail.com");
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored!);
    expect(parsed.code).toBe(body.data.dev_otp);
  });

  it("should enforce 30s rate limiting on requesting OTP again immediately", async () => {
    await app.inject({
      method: "POST",
      url: "/api/v1/auth/send-otp",
      payload: {
        email: "rate.limit.test@gmail.com",
      },
    });

    // Immediate second attempt
    const secondRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/send-otp",
      payload: {
        email: "rate.limit.test@gmail.com",
      },
    });

    expect(secondRes.statusCode).toBe(429);
    const body = secondRes.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("RATE_LIMITED");
  });

  it("should reject an invalid OTP", async () => {
    await app.inject({
      method: "POST",
      url: "/api/v1/auth/send-otp",
      payload: {
        email: "wrong.otp.user@gmail.com",
      },
    });

    const verifyRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/verify-otp",
      payload: {
        email: "wrong.otp.user@gmail.com",
        otp: "000000",
      },
    });

    expect(verifyRes.statusCode).toBe(400);
    const body = verifyRes.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("INVALID_OTP");
  });

  it("should verify correct OTP, create user & wallet with ₹1,000 welcome bonus", async () => {
    const sendRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/send-otp",
      payload: {
        email: "satoshi.nakamoto@gmail.com",
      },
    });

    const otp = sendRes.json().data.dev_otp;

    const verifyRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/verify-otp",
      payload: {
        email: "satoshi.nakamoto@gmail.com",
        otp,
        full_name: "Satoshi Nakamoto",
      },
    });

    expect(verifyRes.statusCode).toBe(200);
    const verifyBody = verifyRes.json();
    expect(verifyBody.success).toBe(true);
    expect(verifyBody.data.is_new).toBe(true);
    expect(verifyBody.data.user.email).toBe("satoshi.nakamoto@gmail.com");
    expect(verifyBody.data.user.full_name).toBe("Satoshi Nakamoto");
    expect(verifyBody.data.user.is_email_verified).toBe(true);
    expect(verifyBody.data.user.auth_provider).toBe("gmail");

    // Check wallet and ₹1,000 (100,000 paise) welcome balance
    expect(verifyBody.data.wallet).toBeDefined();
    expect(verifyBody.data.wallet.currency).toBe("INR");
    expect(verifyBody.data.wallet.cached_balance).toBe("100000");

    // OTP in Redis should be wiped immediately after verification
    const remainingOtp = await redis.get("otp:gmail:satoshi.nakamoto@gmail.com");
    expect(remainingOtp).toBeNull();
  });

  it("should re-authenticate existing user on subsequent OTP verification without duplicating wallet", async () => {
    // 1. First signup
    const send1 = await app.inject({
      method: "POST",
      url: "/api/v1/auth/send-otp",
      payload: { email: "returning.user@gmail.com" },
    });
    const otp1 = send1.json().data.dev_otp;

    const verify1 = await app.inject({
      method: "POST",
      url: "/api/v1/auth/verify-otp",
      payload: {
        email: "returning.user@gmail.com",
        otp: otp1,
        full_name: "Returning User",
      },
    });
    const firstUser = verify1.json().data.user;
    const firstWallet = verify1.json().data.wallet;

    // Reset rate limiter so we can request another OTP
    await redis.del("otp:rate:returning.user@gmail.com");

    // 2. Second login via OTP
    const send2 = await app.inject({
      method: "POST",
      url: "/api/v1/auth/send-otp",
      payload: { email: "returning.user@gmail.com" },
    });
    const otp2 = send2.json().data.dev_otp;

    const verify2 = await app.inject({
      method: "POST",
      url: "/api/v1/auth/verify-otp",
      payload: {
        email: "returning.user@gmail.com",
        otp: otp2,
      },
    });

    const secondData = verify2.json().data;
    expect(secondData.is_new).toBe(false);
    expect(secondData.user.id).toBe(firstUser.id);
    expect(secondData.wallet.id).toBe(firstWallet.id);
  });
});
