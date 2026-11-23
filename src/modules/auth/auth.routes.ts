import { FastifyInstance } from "fastify";
import { authService } from "./auth.service.js";
import { loginSchema, registerSchema } from "./auth.schema.js";

export async function authRoutes(fastify: FastifyInstance): Promise<void> {
  // POST /api/v1/auth/register
  fastify.post("/register", async (request, reply) => {
    const validated = registerSchema.parse(request.body);
    const result = await authService.register(validated);

    return reply.status(201).send({
      success: true,
      data: result,
    });
  });

  // POST /api/v1/auth/login
  fastify.post("/login", async (request, reply) => {
    const validated = loginSchema.parse(request.body);
    const result = await authService.login(validated);

    return reply.status(200).send({
      success: true,
      data: result,
    });
  });

  // GET /api/v1/auth/users (for transfer autocomplete)
  fastify.get("/users", async (request, reply) => {
    const query = request.query as { q?: string; exclude?: string };
    const users = await authService.searchUsers(query.q || "", query.exclude);

    return reply.status(200).send({
      success: true,
      data: users,
    });
  });

  // GET /api/v1/auth/me/:id
  fastify.get("/me/:id", async (request, reply) => {
    const params = request.params as { id: string };
    const result = await authService.getUserProfile(params.id);

    return reply.status(200).send({
      success: true,
      data: result,
    });
  });
}
