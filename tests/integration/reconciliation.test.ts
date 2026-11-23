import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { getTestApp, resetDatabase, closeTestResources } from "../test-helper.js";
import { query } from "../../src/db/client.js";
import { FastifyInstance } from "fastify";
import crypto from "crypto";

describe("Ledger Reconciliation & Audit Suite", () => {
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

  it("should reconcile cleanly on initial state", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/audit/reconcile",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.reconciled).toBe(true);
    expect(body.data.discrepancies).toHaveLength(0);
    expect(body.data.summary.system_net_delta).toBe("0");
  });

  it("should verify complete double-entry integrity and balance conservation across multiple transactions", async () => {
    // 1. Create 3 accounts
    const acc1 = await app.inject({
      method: "POST",
      url: "/api/v1/accounts",
      payload: { user_id: "user_audit_1" },
    });
    const id1 = acc1.json().data.id;

    const acc2 = await app.inject({
      method: "POST",
      url: "/api/v1/accounts",
      payload: { user_id: "user_audit_2" },
    });
    const id2 = acc2.json().data.id;

    const acc3 = await app.inject({
      method: "POST",
      url: "/api/v1/accounts",
      payload: { user_id: "user_audit_3" },
    });
    const id3 = acc3.json().data.id;

    // 2. Deposit funds
    await app.inject({
      method: "POST",
      url: "/api/v1/deposits",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      payload: { account_id: id1, amount: 50000 }, // ₹500
    });

    await app.inject({
      method: "POST",
      url: "/api/v1/deposits",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      payload: { account_id: id2, amount: 30000 }, // ₹300
    });

    // 3. Chain transfers: 1 -> 2, 2 -> 3, 3 -> 1
    await app.inject({
      method: "POST",
      url: "/api/v1/transfers",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      payload: { from_account_id: id1, to_account_id: id2, amount: 15000 },
    });

    await app.inject({
      method: "POST",
      url: "/api/v1/transfers",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      payload: { from_account_id: id2, to_account_id: id3, amount: 20000 },
    });

    await app.inject({
      method: "POST",
      url: "/api/v1/transfers",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      payload: { from_account_id: id3, to_account_id: id1, amount: 5000 },
    });

    // 4. Run system-wide reconciliation audit
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/audit/reconcile",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.reconciled).toBe(true);
    expect(body.data.discrepancies).toHaveLength(0);
    expect(body.data.summary.total_transactions).toBe(5);
    expect(body.data.summary.total_ledger_entries).toBe(10); // 5 txns * 2 balanced entries
    expect(body.data.summary.system_net_delta).toBe("0");
    expect(body.data.summary.total_debits).toBe(body.data.summary.total_credits);
  });

  it("should detect balance tampering as a discrepancy", async () => {
    const acc = await app.inject({
      method: "POST",
      url: "/api/v1/accounts",
      payload: { user_id: "user_tamper" },
    });
    const id = acc.json().data.id;

    await app.inject({
      method: "POST",
      url: "/api/v1/deposits",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      payload: { account_id: id, amount: 10000 },
    });

    // Artificially tamper with cached_balance directly in DB without a ledger entry
    await query(`UPDATE accounts SET cached_balance = 99999 WHERE id = $1`, [id]);

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/audit/reconcile",
    });

    const body = res.json();
    expect(body.data.reconciled).toBe(false);
    expect(body.data.discrepancies.length).toBeGreaterThan(0);
    const mismatch = body.data.discrepancies.find(
      (d: any) => d.type === "ACCOUNT_BALANCE_MISMATCH" && d.id === id
    );
    expect(mismatch).toBeDefined();
    expect(mismatch.expected).toBe("10000");
    expect(mismatch.actual).toBe("99999");
  });
});
