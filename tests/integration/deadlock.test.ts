import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { getTestApp, resetDatabase, closeTestResources } from "../test-helper.js";
import { FastifyInstance } from "fastify";
import crypto from "crypto";

describe("Deadlock Avoidance Stress Suite", () => {
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

  it("Requirement 3: Simultaneously transferring A -> B and B -> A succeeds without PostgreSQL deadlock errors", async () => {
    // 1. Create Account A and Account B
    const userARes = await app.inject({
      method: "POST",
      url: "/api/v1/accounts",
      payload: { user_id: "user_deadlock_a" },
    });
    const accountAId = userARes.json().data.id;

    const userBRes = await app.inject({
      method: "POST",
      url: "/api/v1/accounts",
      payload: { user_id: "user_deadlock_b" },
    });
    const accountBId = userBRes.json().data.id;

    // 2. Fund Account A with ₹1,000 (100,000 paise) and Account B with ₹1,000 (100,000 paise)
    await app.inject({
      method: "POST",
      url: "/api/v1/deposits",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      payload: { account_id: accountAId, amount: 100000 },
    });

    await app.inject({
      method: "POST",
      url: "/api/v1/deposits",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      payload: { account_id: accountBId, amount: 100000 },
    });

    // 3. Prepare 20 simultaneous cross-transfers:
    // 10 transfers: A -> B of ₹10 (1,000 paise) each
    // 10 transfers: B -> A of ₹10 (1,000 paise) each
    const aToBRequests = Array.from({ length: 10 }).map((_, idx) =>
      app.inject({
        method: "POST",
        url: "/api/v1/transfers",
        headers: { "Idempotency-Key": `deadlock_atob_${idx}_${crypto.randomUUID()}` },
        payload: {
          from_account_id: accountAId,
          to_account_id: accountBId,
          amount: 1000,
          description: `A to B transfer #${idx + 1}`,
        },
      })
    );

    const bToARequests = Array.from({ length: 10 }).map((_, idx) =>
      app.inject({
        method: "POST",
        url: "/api/v1/transfers",
        headers: { "Idempotency-Key": `deadlock_btoa_${idx}_${crypto.randomUUID()}` },
        payload: {
          from_account_id: accountBId,
          to_account_id: accountAId,
          amount: 1000,
          description: `B to A transfer #${idx + 1}`,
        },
      })
    );

    // Interleave requests and fire simultaneously
    const allRequests: Promise<any>[] = [];
    for (let i = 0; i < 10; i++) {
      allRequests.push(aToBRequests[i], bToARequests[i]);
    }

    const responses = await Promise.all(allRequests);

    // 4. Assertions: Zero deadlocks (PostgreSQL error 40P01)
    for (const res of responses) {
      expect(res.statusCode).toBe(201);
      const json = res.json();
      expect(json.success).toBe(true);
      expect(json.error).toBeUndefined();
    }

    // 5. Assert Conservation of Value
    const balanceA = await app.inject({
      method: "GET",
      url: `/api/v1/accounts/${accountAId}/balance`,
    });
    const balanceB = await app.inject({
      method: "GET",
      url: `/api/v1/accounts/${accountBId}/balance`,
    });

    const balA = BigInt(balanceA.json().data.account.balance);
    const balB = BigInt(balanceB.json().data.account.balance);

    // 10 out of A and 10 into A -> net change 0 -> 100,000 paise
    expect(balA).toBe(100000n);
    expect(balB).toBe(100000n);
    expect(balA + balB).toBe(200000n);
  });
});
