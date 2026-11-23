import { z } from "zod";

export const createAccountSchema = z.object({
  user_id: z.string().min(1, "user_id is required"),
  currency: z.string().length(3).default("INR").transform((c) => c.toUpperCase()),
  account_number: z.string().min(3).max(64).optional(),
});

export type CreateAccountInput = z.infer<typeof createAccountSchema>;

export const getBalanceParamsSchema = z.object({
  id: z.string().uuid("Invalid account ID format"),
});

export const getBalanceQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});
