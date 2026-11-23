import { z } from "zod";

export const depositSchema = z.object({
  account_id: z.string().uuid("Invalid target account ID"),
  amount: z
    .union([z.number().int().positive(), z.string().regex(/^[1-9]\d*$/, "Amount must be a positive integer")])
    .transform((val) => BigInt(val)),
  description: z.string().max(255).optional(),
});

export type DepositInput = z.infer<typeof depositSchema>;
