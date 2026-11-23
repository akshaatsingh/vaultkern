import { FastifyInstance } from "fastify";
import { authService } from "./auth.service.js";
import { loginSchema, registerSchema, sendOtpSchema, verifyOtpSchema } from "./auth.schema.js";

export async function authRoutes(fastify: FastifyInstance): Promise<void> {
  // POST /api/v1/auth/send-otp (Send 6-digit verification code to Gmail)
  fastify.post("/send-otp", async (request, reply) => {
    const validated = sendOtpSchema.parse(request.body);
    const result = await authService.sendGmailOtp(validated);

    return reply.status(200).send({
      success: true,
      data: result,
    });
  });

  // POST /api/v1/auth/verify-otp (Verify OTP & activate account / sign in)
  fastify.post("/verify-otp", async (request, reply) => {
    const validated = verifyOtpSchema.parse(request.body);
    const result = await authService.verifyGmailOtp(validated);

    return reply.status(200).send({
      success: true,
      data: result,
    });
  });

  // POST /api/v1/auth/register (Standard local registration)
  fastify.post("/register", async (request, reply) => {
    const validated = registerSchema.parse(request.body);
    const result = await authService.register(validated);

    return reply.status(201).send({
      success: true,
      data: result,
    });
  });

  // POST /api/v1/auth/login (Standard local login)
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
