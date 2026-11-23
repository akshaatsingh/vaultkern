import { z } from "zod";

export const transferSchema = z.object({
  from_account_id: z.string().uuid("Invalid source account ID"),
  to_account_id: z.string().uuid("Invalid destination account ID"),
  amount: z
    .union([z.number().int().positive(), z.string().regex(/^[1-9]\d*$/, "Amount must be a positive integer")])
    .transform((val) => BigInt(val)),
  description: z.string().max(255).optional(),
});

export type TransferInput = z.infer<typeof transferSchema>;
