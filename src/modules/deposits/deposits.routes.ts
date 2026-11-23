import { FastifyInstance } from "fastify";
import { depositsService } from "./deposits.service.js";
import { depositSchema } from "./deposits.schema.js";
import {
  idempotencyHook,
  saveIdempotentResponse,
  clearIdempotencyLock,
} from "../../middleware/idempotency.js";

export async function depositsRoutes(fastify: FastifyInstance): Promise<void> {
  // POST /api/v1/deposits - Add funds from external system funding
  fastify.post(
    "/",
    {
      preHandler: idempotencyHook,
    },
    async (request, reply) => {
      // If response was already fulfilled and replayed by idempotency hook, halt execution
      if (reply.sent) {
        return;
      }

      const validatedInput = depositSchema.parse(request.body);
      const idempotency = (request as any).idempotency;

      try {
        const result = await depositsService.executeDeposit(
          validatedInput,
          idempotency.key
        );

        const responsePayload = {
          success: true,
          data: result,
        };

        // Persist response for idempotent replays
        await saveIdempotentResponse(
          idempotency.key,
          idempotency.requestHash,
          201,
          responsePayload
        );

        return reply.status(201).send(responsePayload);
      } catch (err) {
        // Clear in-flight lock on failure so client can retry
        await clearIdempotencyLock(idempotency.key);
        throw err;
      }
    }
  );
}
