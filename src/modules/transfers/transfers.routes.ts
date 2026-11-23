import { FastifyInstance } from "fastify";
import { transfersService } from "./transfers.service.js";
import { transferSchema } from "./transfers.schema.js";
import {
  idempotencyHook,
  saveIdempotentResponse,
  clearIdempotencyLock,
} from "../../middleware/idempotency.js";

export async function transfersRoutes(fastify: FastifyInstance): Promise<void> {
  // POST /api/v1/transfers - Transfer funds between two user accounts
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

      const validatedInput = transferSchema.parse(request.body);
      const idempotency = (request as any).idempotency;

      try {
        const result = await transfersService.executeTransfer(
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
