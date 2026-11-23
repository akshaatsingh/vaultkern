import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { getTestApp, resetDatabase, closeTestResources } from "../test-helper.js";
import { query } from "../../src/db/client.js";
import { FastifyInstance } from "fastify";
import crypto from "crypto";

describe("Deposits API & Double-Entry Invariants", () => {
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

  it("should fail deposit if Idempotency-Key header is missing", async () => {
    const accountRes = await app.inject({
      method: "POST",
      url: "/api/v1/accounts",
      payload: { user_id: "user_dep_0" },
    });
    const accountId = accountRes.json().data.id;

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/deposits",
      payload: {
        account_id: accountId,
        amount: 5000,
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("MISSING_IDEMPOTENCY_KEY");
  });

  it("should execute deposit creating balanced immutable ledger entries", async () => {
    const accountRes = await app.inject({
      method: "POST",
      url: "/api/v1/accounts",
      payload: { user_id: "user_dep_1" },
    });
    const accountId = accountRes.json().data.id;

    const idempotencyKey = crypto.randomUUID();
    const depositAmount = 10000; // ₹100 in paise

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/deposits",
      headers: {
        "Idempotency-Key": idempotencyKey,
      },
      payload: {
        account_id: accountId,
        amount: depositAmount,
        description: "Initial wallet funding",
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.user_account.balance).toBe("10000");
    const txnId = body.data.transaction.id;

    // Verify exactly 2 ledger entries were created for this transaction
    const entries = await query(
      `SELECT * FROM ledger_entries WHERE transaction_id = $1 ORDER BY sequence_num ASC`,
      [txnId]
    );

    expect(entries.rows).toHaveLength(2);

    const debitEntry = entries.rows[0];
    const creditEntry = entries.rows[1];

    // Double-entry assertions:
    // Debit entry on system reserve
    expect(debitEntry.direction).toBe("DEBIT");
    expect(debitEntry.amount).toBe("10000");
    expect(debitEntry.account_id).toBe("00000000-0000-0000-0000-000000000001");

    // Credit entry on user account
    expect(creditEntry.direction).toBe("CREDIT");
    expect(creditEntry.amount).toBe("10000");
    expect(creditEntry.account_id).toBe(accountId);

    // Sum of entries must equal 0
    expect(BigInt(debitEntry.amount) - BigInt(creditEntry.amount)).toBe(0n);
  });
});
