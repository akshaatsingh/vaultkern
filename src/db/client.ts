import { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";
import { config } from "../config/env.js";

export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  max: 30, // Support high concurrency stress tests
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on("error", (err) => {
  console.error("Unexpected error on idle PostgreSQL client", err);
});

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<QueryResult<T>> {
  return pool.query<T>(text, params);
}

export async function getClient(): Promise<PoolClient> {
  return pool.connect();
}

export async function withTransaction<T>(
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN;");
    const result = await callback(client);
    await client.query("COMMIT;");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK;");
    } catch (rollbackError) {
      console.error("Error rolling back transaction", rollbackError);
    }
    throw error;
  } finally {
    client.release();
  }
}
