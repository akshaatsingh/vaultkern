import { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { query } from "../src/db/client.js";
import { redis, connectRedis } from "../src/redis/client.js";

let testApp: FastifyInstance | null = null;

export async function getTestApp(): Promise<FastifyInstance> {
  if (!testApp) {
    testApp = buildApp();
    await testApp.ready();
    await connectRedis();
  }
  return testApp;
}

export async function resetDatabase(): Promise<void> {
  await redis.flushall();

  // Reset database tables
  await query(`
    TRUNCATE accounts, transactions, idempotency_keys, users CASCADE;
  `);

  // Truncate ledger_entries specifically by temporarily bypassing the trigger
  await query(`
    ALTER TABLE ledger_entries DISABLE TRIGGER trg_ledger_entries_immutable;
    TRUNCATE ledger_entries CASCADE;
    ALTER TABLE ledger_entries ENABLE TRIGGER trg_ledger_entries_immutable;
  `);

  // Reseed System External Reserve Account
  await query(`
    INSERT INTO accounts (id, account_number, user_id, type, currency, status, cached_balance)
    VALUES (
      '00000000-0000-0000-0000-000000000001',
      'SYS_EXTERNAL_RESERVE_INR',
      'SYSTEM',
      'SYSTEM_EXTERNAL_FUNDING',
      'INR',
      'ACTIVE',
      0
    )
    ON CONFLICT (id) DO NOTHING;
  `);
}

export async function closeTestResources(): Promise<void> {
  if (testApp) {
    await testApp.close();
    testApp = null;
  }
}
