import { buildApp } from "./app.js";
import { config } from "./config/env.js";
import { connectRedis } from "./redis/client.js";
import { pool } from "./db/client.js";

async function main() {
  const app = buildApp();

  try {
    // Check PostgreSQL connection
    const client = await pool.connect();
    client.release();
    console.log("PostgreSQL connection established.");

    // Connect Redis
    await connectRedis();

    await app.listen({
      port: config.PORT,
      host: config.HOST,
    });

    console.log(`Vaultkern API running on http://${config.HOST}:${config.PORT}`);
  } catch (err) {
    console.error("Failed to start server:", err);
    process.exit(1);
  }
}

main();
