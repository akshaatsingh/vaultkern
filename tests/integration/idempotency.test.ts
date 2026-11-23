import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { getTestApp, resetDatabase, closeTestResources } from "../test-helper.js";
import { query } from "../../src/db/client.js";
import { FastifyInstance } from "fastify";
import crypto from "crypto";

describe("Idempotency Verification Suite", () => {
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

  it("Requirement 1: Sending 10 simultaneous POST /transfers requests with the same Idempotency-Key transfers money exactly ONCE", async () => {
    // 1. Create Sender and Receiver
    const userA = await app.inject({
      method: "POST",
      url: "/api/v1/accounts",
      payload: { user_id: "user_concurrent_a" },
    });
    const senderId = userA.json().data.id;

    const userB = await app.inject({
      method: "POST",
      url: "/api/v1/accounts",
      payload: { user_id: "user_concurrent_b" },
    });
    const receiverId = userB.json().data.id;

    // 2. Fund Sender with ₹500 (50,000 paise)
    await app.inject({
      method: "POST",
      url: "/api/v1/deposits",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      payload: { account_id: senderId, amount: 50000 },
    });

    // 3. Fire 10 simultaneous transfers with the EXACT same Idempotency-Key and payload
    const sharedIdempotencyKey = `idem_shared_${crypto.randomUUID()}`;
    const transferPayload = {
      from_account_id: senderId,
      to_account_id: receiverId,
      amount: 5000, // ₹50 (5,000 paise)
      description: "Concurrent idempotency test",
    };

    const requests = Array.from({ length: 10 }).map(() =>
      app.inject({
        method: "POST",
        url: "/api/v1/transfers",
        headers: { "Idempotency-Key": sharedIdempotencyKey },
        payload: transferPayload,
      })
    );

    const responses = await Promise.all(requests);

    // Verify all 10 requests returned successful 200 or 201 status
    for (const res of responses) {
      expect([200, 201]).toContain(res.statusCode);
      expect(res.json().success).toBe(true);
    }

    // Verify all 10 responses point to the EXACT same transaction reference / ID
    const firstTxnId = responses[0].json().data.transaction.id;
    for (const res of responses) {
      expect(res.json().data.transaction.id).toBe(firstTxnId);
    }

    // Check Sender Balance: Must have decreased by 5,000 paise ONCE (50,000 - 5,000 = 45,000 paise)
    const senderCheck = await app.inject({
      method: "GET",
      url: `/api/v1/accounts/${senderId}/balance`,
    });
    expect(senderCheck.json().data.account.balance).toBe("45000");

    // Check Receiver Balance: Must be exactly 5,000 paise
    const receiverCheck = await app.inject({
      method: "GET",
      url: `/api/v1/accounts/${receiverId}/balance`,
    });
    expect(receiverCheck.json().data.account.balance).toBe("5000");

    // Check Database: Exactly ONE transaction record exists for this idempotency key
    const dbTxns = await query(
      `SELECT * FROM transactions WHERE idempotency_key = $1;`,
      [sharedIdempotencyKey]
    );
    expect(dbTxns.rows).toHaveLength(1);

    // Check Database: Exactly TWO ledger entries exist (1 DEBIT, 1 CREDIT)
    const dbEntries = await query(
      `SELECT * FROM ledger_entries WHERE transaction_id = $1;`,
      [firstTxnId]
    );
    expect(dbEntries.rows).toHaveLength(2);
  });

  it("should return 409 Conflict if same Idempotency-Key is reused with a different payload", async () => {
    const userA = await app.inject({
      method: "POST",
      url: "/api/v1/accounts",
      payload: { user_id: "user_conflict_a" },
    });
    const senderId = userA.json().data.id;

    const userB = await app.inject({
      method: "POST",
      url: "/api/v1/accounts",
      payload: { user_id: "user_conflict_b" },
    });
    const receiverId = userB.json().data.id;

    await app.inject({
      method: "POST",
      url: "/api/v1/deposits",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      payload: { account_id: senderId, amount: 20000 },
    });

    const key = `test_conflict_${crypto.randomUUID()}`;

    // First request: transfer 1,000 paise
    const res1 = await app.inject({
      method: "POST",
      url: "/api/v1/transfers",
      headers: { "Idempotency-Key": key },
      payload: {
        from_account_id: senderId,
        to_account_id: receiverId,
        amount: 1000,
      },
    });
    expect(res1.statusCode).toBe(201);

    // Second request: same key, but transfer 2,000 paise (different payload)
    const res2 = await app.inject({
      method: "POST",
      url: "/api/v1/transfers",
      headers: { "Idempotency-Key": key },
      payload: {
        from_account_id: senderId,
        to_account_id: receiverId,
        amount: 2000, // Different amount!
      },
    });
    expect(res2.statusCode).toBe(409);
    expect(res2.json().error.code).toBe("IDEMPOTENCY_CONFLICT");
  });
});
