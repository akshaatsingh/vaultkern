import { FastifyInstance } from "fastify";
import { accountsService } from "./accounts.service.js";
import {
  createAccountSchema,
  getBalanceParamsSchema,
  getBalanceQuerySchema,
} from "./accounts.schema.js";

export async function accountsRoutes(fastify: FastifyInstance): Promise<void> {
  // POST /api/v1/accounts - Create a user wallet
  fastify.post("/", async (request, reply) => {
    const validatedInput = createAccountSchema.parse(request.body);
    const account = await accountsService.createAccount(validatedInput);

    return reply.status(201).send({
      success: true,
      data: account,
    });
  });

  // GET /api/v1/accounts/:id/balance - Fetch balance and paginated ledger history
  fastify.get("/:id/balance", async (request, reply) => {
    const params = getBalanceParamsSchema.parse(request.params);
    const query = getBalanceQuerySchema.parse(request.query);

    const data = await accountsService.getAccountBalanceAndHistory(
      params.id,
      query.limit,
      query.offset
    );

    return reply.status(200).send({
      success: true,
      data,
    });
  });
}
