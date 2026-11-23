import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { getTestApp, resetDatabase, closeTestResources } from "../test-helper.js";
import { FastifyInstance } from "fastify";
import crypto from "crypto";

describe("Overdraft Race-Condition Stress Suite", () => {
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

  it("Requirement 2: Account A has ₹100. Firing 5 simultaneous ₹80 transfers from Account A to Account B results in exactly 1 success and 4 insufficient-funds failures", async () => {
    // 1. Create Account A and Account B
    const userARes = await app.inject({
      method: "POST",
      url: "/api/v1/accounts",
      payload: { user_id: "user_alice" },
    });
    const accountAId = userARes.json().data.id;

    const userBRes = await app.inject({
      method: "POST",
      url: "/api/v1/accounts",
      payload: { user_id: "user_bob" },
    });
    const accountBId = userBRes.json().data.id;

    // 2. Fund Account A with exactly ₹100 (10,000 paise)
    await app.inject({
      method: "POST",
      url: "/api/v1/deposits",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      payload: {
        account_id: accountAId,
        amount: 10000, // ₹100
      },
    });

    // Verify initial balance
    const initialCheck = await app.inject({
      method: "GET",
      url: `/api/v1/accounts/${accountAId}/balance`,
    });
    expect(initialCheck.json().data.account.balance).toBe("10000");

    // 3. Fire 5 simultaneous transfers of ₹80 (8,000 paise) each to Account B
    // Each request has a UNIQUE Idempotency-Key
    const requests = Array.from({ length: 5 }).map((_, index) =>
      app.inject({
        method: "POST",
        url: "/api/v1/transfers",
        headers: {
          "Idempotency-Key": `race_key_${index}_${crypto.randomUUID()}`,
        },
        payload: {
          from_account_id: accountAId,
          to_account_id: accountBId,
          amount: 8000, // ₹80 in paise
          description: `Race transfer attempt ${index + 1}`,
        },
      })
    );

    const responses = await Promise.all(requests);

    // Count successes and failures
    const successes = responses.filter((r) => r.statusCode === 201);
    const failures = responses.filter(
      (r) => r.statusCode === 422 || r.statusCode === 400
    );

    // Invariants: Exactly 1 must succeed, exactly 4 must fail
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(4);

    // Verify failure error codes
    for (const fail of failures) {
      expect(fail.json().error.code).toBe("INSUFFICIENT_FUNDS");
    }

    // 4. Verify Final Balances
    const finalBalanceA = await app.inject({
      method: "GET",
      url: `/api/v1/accounts/${accountAId}/balance`,
    });
    // ₹100 - ₹80 = ₹20 (2,000 paise)
    expect(finalBalanceA.json().data.account.balance).toBe("2000");

    const finalBalanceB = await app.inject({
      method: "GET",
      url: `/api/v1/accounts/${accountBId}/balance`,
    });
    // ₹80 (8,000 paise)
    expect(finalBalanceB.json().data.account.balance).toBe("8000");
  });
});
