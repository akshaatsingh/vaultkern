import { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";
import { AppError } from "../common/errors.js";

export function errorHandler(
  error: FastifyError | Error,
  request: FastifyRequest,
  reply: FastifyReply
) {
  // App Domain Errors
  if (error instanceof AppError) {
    return reply.status(error.statusCode).send({
      success: false,
      error: {
        code: error.code,
        message: error.message,
        details: error.details ?? null,
      },
    });
  }

  // Malformed JSON or Fastify Body Parsing SyntaxError
  if (
    error instanceof SyntaxError ||
    error.name === "SyntaxError" ||
    ((error as any).statusCode === 400 && !("code" in error))
  ) {
    return reply.status(400).send({
      success: false,
      error: {
        code: "INVALID_JSON",
        message: "Malformed JSON payload: " + error.message,
      },
    });
  }

  // Zod Validation Errors
  if (error instanceof ZodError) {
    return reply.status(400).send({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid request payload or parameters",
        details: error.errors.map((e) => ({
          field: e.path.join("."),
          message: e.message,
        })),
      },
    });
  }

  // Fastify Schema Validation Errors
  if ("validation" in error && Array.isArray((error as any).validation)) {
    return reply.status(400).send({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: error.message,
        details: (error as any).validation,
      },
    });
  }

  // PostgreSQL Specific Errors
  const pgError = error as any;
  if (pgError.code) {
    // 23514: check_violation (e.g. cached_balance >= 0 or amount > 0)
    if (pgError.code === "23514") {
      return reply.status(422).send({
        success: false,
        error: {
          code: "INSUFFICIENT_FUNDS_CONSTRAINT",
          message: "Database invariant violation: account balance cannot become negative",
          details: pgError.constraint,
        },
      });
    }

    // 23505: unique_violation
    if (pgError.code === "23505") {
      return reply.status(409).send({
        success: false,
        error: {
          code: "DUPLICATE_RESOURCE",
          message: "A resource with these unique attributes already exists",
          details: pgError.detail,
        },
      });
    }

    // 40P01: deadlock_detected
    if (pgError.code === "40P01") {
      return reply.status(503).send({
        success: false,
        error: {
          code: "TRANSACTION_DEADLOCK",
          message: "Transaction conflict detected. Please retry request.",
        },
      });
    }
  }

  // Fallback 500 Internal Server Error
  console.error("Unhandled API error:", error);
  request.log.error(error);
  return reply.status(500).send({
    success: false,
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: "An unexpected error occurred while processing your request",
    },
  });
}
