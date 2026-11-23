import { FastifyInstance } from "fastify";
import { auditService } from "./audit.service.js";
import { config } from "../../config/env.js";
import { UnauthorizedError } from "../../common/errors.js";

export async function auditRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /api/v1/audit/reconcile - Full system-wide ledger reconciliation check
  fastify.get("/reconcile", async (request, reply) => {
    // Check admin authentication in production
    const adminKey = request.headers["x-admin-key"];
    if (config.NODE_ENV === "production" && adminKey !== config.ADMIN_API_KEY) {
      throw new UnauthorizedError();
    }

    const report = await auditService.reconcile();

    return reply.status(200).send({
      success: true,
      data: report,
    });
  });
}
