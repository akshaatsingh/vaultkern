import { z } from "zod";

export const registerSchema = z.object({
  username: z
    .string()
    .min(3, "Username must be at least 3 characters")
    .max(32)
    .regex(/^[a-zA-Z0-9_]+$/, "Username can only contain letters, numbers, and underscores"),
  full_name: z.string().min(2, "Full name must be at least 2 characters").max(64),
  email: z.string().email("Invalid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  currency: z.string().length(3).default("INR"),
});

export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  login: z.string().min(1, "Username or email is required"),
  password: z.string().min(1, "Password is required"),
});

export type LoginInput = z.infer<typeof loginSchema>;

// Gmail OTP Schemas
export const sendOtpSchema = z.object({
  email: z
    .string()
    .email("Invalid email address")
    .refine(
      (email) => {
        const lower = email.toLowerCase().trim();
        return lower.endsWith("@gmail.com") || lower.endsWith("@googlemail.com");
      },
      {
        message: "Sign-in requires a valid Gmail account (@gmail.com)",
      }
    ),
});

export type SendOtpInput = z.infer<typeof sendOtpSchema>;

export const verifyOtpSchema = z.object({
  email: z
    .string()
    .email("Invalid email address")
    .refine(
      (email) => {
        const lower = email.toLowerCase().trim();
        return lower.endsWith("@gmail.com") || lower.endsWith("@googlemail.com");
      },
      {
        message: "Sign-in requires a valid Gmail account (@gmail.com)",
      }
    ),
  otp: z
    .string()
    .length(6, "OTP must be exactly 6 digits")
    .regex(/^\d{6}$/, "OTP must contain only numbers"),
  full_name: z.string().max(64).optional(),
});

export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>;

// User Profile Customizations Schema
export const updateProfileSchema = z.object({
  full_name: z.string().min(2, "Name must be at least 2 characters").max(64).optional(),
  bio: z.string().max(255, "Bio must be under 255 characters").optional(),
  phone_number: z.string().max(32).optional(),
  country: z.string().max(64).optional(),
  preferred_currency: z.string().length(3).optional(),
  tier: z.enum(["Standard", "Plus", "Metal", "Ultra"]).optional(),
  avatar_style: z.enum(["avataaars", "bottts", "lorelei", "micah", "fun-emoji", "thumbs"]).optional(),
  avatar_seed: z.string().max(64).optional(),
  card_finish: z.enum(["finish-space-grey", "finish-obsidian", "finish-cyan", "finish-gold"]).optional(),
  hide_balance: z.boolean().optional(),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
