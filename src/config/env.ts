import { z } from "zod";
import dotenv from "dotenv";

dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default("0.0.0.0"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().default("postgresql://vaultkern:vaultkern_secret@localhost:5432/vaultkern_db"),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  ADMIN_API_KEY: z.string().default("vaultkern_admin_secret_key_2026"),
});

export const config = envSchema.parse(process.env);
export type Config = z.infer<typeof envSchema>;
