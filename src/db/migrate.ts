import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { pool } from "./client.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function runMigrations(): Promise<void> {
  const client = await pool.connect();
  try {
    console.log("Running database migrations...");
    const migrationsDir = path.join(__dirname, "migrations");
    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    for (const file of files) {
      console.log(`Applying migration: ${file}`);
      const sql = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
      await client.query(sql);
    }
    console.log("All database migrations applied successfully.");
  } catch (error) {
    console.error("Failed to run migrations:", error);
    throw error;
  } finally {
    client.release();
  }
}

// Auto-run if executed directly
if (process.argv[1] === __filename) {
  runMigrations()
    .then(async () => {
      await pool.end();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error(err);
      await pool.end();
      process.exit(1);
    });
}
