import Fastify, { FastifyInstance } from "fastify";
import { errorHandler } from "./middleware/errorHandler.js";
import { accountsRoutes } from "./modules/accounts/accounts.routes.js";
import { depositsRoutes } from "./modules/deposits/deposits.routes.js";
import { transfersRoutes } from "./modules/transfers/transfers.routes.js";
import { auditRoutes } from "./modules/audit/audit.routes.js";
import { dashboardRoutes } from "./modules/dashboard/dashboard.routes.js";
import { pool } from "./db/client.js";
import { redis } from "./redis/client.js";

export function buildApp(): FastifyInstance {
  const app = Fastify({
    logger: false, // Clean test & benchmark output
  });

  // Custom Domain Error Handler
  app.setErrorHandler(errorHandler);

  // Healthcheck endpoint
  app.get("/health", async () => {
    return {
      status: "ok",
      timestamp: new Date().toISOString(),
      service: "vaultkern",
    };
  });

  // Web Dashboard UI
  app.register(dashboardRoutes);

  // API V1 Routes
  app.register(accountsRoutes, { prefix: "/api/v1/accounts" });
  app.register(depositsRoutes, { prefix: "/api/v1/deposits" });
  app.register(transfersRoutes, { prefix: "/api/v1/transfers" });
  app.register(auditRoutes, { prefix: "/api/v1/audit" });

  // Graceful shutdown hooks
  app.addHook("onClose", async () => {
    await pool.end();
    if (redis.status !== "end") {
      await redis.quit();
    }
  });

  return app;
}
