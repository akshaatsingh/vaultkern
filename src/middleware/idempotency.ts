import { FastifyReply, FastifyRequest } from "fastify";
import crypto from "crypto";
import { redis } from "../redis/client.js";
import { query } from "../db/client.js";
import {
  AppError,
  ConcurrentRequestError,
  IdempotencyConflictError,
} from "../common/errors.js";

export interface CachedIdempotencyData {
  requestHash: string;
  status: "IN_FLIGHT" | "COMPLETED" | "FAILED";
  responseStatus?: number;
  responseBody?: unknown;
}

export function generateRequestHash(method: string, url: string, body: unknown): string {
  const canonicalBody = body ? JSON.stringify(sortObjectKeys(body)) : "{}";
  const raw = `${method.toUpperCase()}:${url}:${canonicalBody}`;
  return crypto.createHash("sha256").update(raw).digest("hex");
}

function sortObjectKeys(obj: any): any {
  if (obj === null || typeof obj !== "object") {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(sortObjectKeys);
  }
  return Object.keys(obj)
    .sort()
    .reduce((result: Record<string, any>, key) => {
      result[key] = sortObjectKeys(obj[key]);
      return result;
    }, {});
}

export async function idempotencyHook(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<FastifyReply | void> {
  const idempotencyKey = request.headers["idempotency-key"] as string | undefined;

  if (!idempotencyKey) {
    throw new AppError(400, "MISSING_IDEMPOTENCY_KEY", "Idempotency-Key header is required");
  }

  const trimmedKey = idempotencyKey.trim();
  if (!trimmedKey) {
    throw new AppError(400, "INVALID_IDEMPOTENCY_KEY", "Idempotency-Key cannot be empty");
  }

  const requestHash = generateRequestHash(request.method, request.url, request.body);
  const redisKey = `idempotency:${trimmedKey}`;

  const checkRecord = (data: CachedIdempotencyData): boolean => {
    if (data.requestHash !== requestHash) {
      throw new IdempotencyConflictError(
        "Idempotency key reused with a different request payload"
      );
    }
    if (data.status === "COMPLETED" && data.responseStatus && data.responseBody !== undefined) {
      reply
        .status(data.responseStatus)
        .header("Idempotent-Replayed", "true")
        .send(data.responseBody);
      return true;
    }
    return false;
  };

  // Helper to wait if a request is already in-flight
  const waitForInFlight = async (): Promise<boolean> => {
    const startTime = Date.now();
    const timeoutMs = 15000;

    while (Date.now() - startTime < timeoutMs) {
      await new Promise((res) => setTimeout(res, 50));
      const val = await redis.get(redisKey);
      if (val) {
        const parsed: CachedIdempotencyData = JSON.parse(val);
        if (checkRecord(parsed)) {
          return true;
        }
      }
    }
    throw new ConcurrentRequestError(
      "A concurrent request with the same Idempotency-Key is currently in progress. Please retry shortly."
    );
  };

  // 1. Check Redis cache
  const cached = await redis.get(redisKey);
  if (cached) {
    const parsed: CachedIdempotencyData = JSON.parse(cached);
    if (parsed.status === "IN_FLIGHT") {
      if (parsed.requestHash !== requestHash) {
        throw new IdempotencyConflictError(
          "Idempotency key reused with a different request payload"
        );
      }
      await waitForInFlight();
      return reply;
    }
    if (checkRecord(parsed)) {
      return reply;
    }
  }

  // 2. Check Database persistence if not in Redis
  const dbResult = await query(
    `SELECT request_hash, status, response_status, response_body 
     FROM idempotency_keys WHERE key = $1`,
    [trimmedKey]
  );

  if (dbResult.rows.length > 0) {
    const row = dbResult.rows[0];
    const data: CachedIdempotencyData = {
      requestHash: row.request_hash,
      status: row.status,
      responseStatus: row.response_status,
      responseBody: row.response_body,
    };
    await redis.set(redisKey, JSON.stringify(data), "EX", 86400);

    if (data.status === "IN_FLIGHT") {
      if (data.requestHash !== requestHash) {
        throw new IdempotencyConflictError(
          "Idempotency key reused with a different request payload"
        );
      }
      await waitForInFlight();
      return reply;
    }
    if (checkRecord(data)) {
      return reply;
    }
  }

  // 3. Atomic Leader Election via Redis SET ... NX
  const inFlightRecord: CachedIdempotencyData = {
    requestHash,
    status: "IN_FLIGHT",
  };
  const lockAcquired = await redis.set(
    redisKey,
    JSON.stringify(inFlightRecord),
    "EX",
    60,
    "NX"
  );

  if (!lockAcquired) {
    // Another concurrent request became the leader. Wait for it to complete.
    await waitForInFlight();
    return reply;
  }

  // 4. This request is the LEADER: record in DB and proceed to execution
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await query(
    `INSERT INTO idempotency_keys (key, endpoint, request_hash, status, expires_at)
     VALUES ($1, $2, $3, 'IN_FLIGHT', $4)
     ON CONFLICT (key) DO UPDATE 
     SET status = 'IN_FLIGHT', request_hash = $3, expires_at = $4`,
    [trimmedKey, request.url, requestHash, expiresAt]
  );

  (request as any).idempotency = {
    key: trimmedKey,
    requestHash,
    redisKey,
  };
}

export async function saveIdempotentResponse(
  key: string,
  requestHash: string,
  statusCode: number,
  body: unknown
): Promise<void> {
  const redisKey = `idempotency:${key}`;

  const completedData: CachedIdempotencyData = {
    requestHash,
    status: "COMPLETED",
    responseStatus: statusCode,
    responseBody: body,
  };

  // Update Redis cache (24 hours TTL)
  await redis.set(redisKey, JSON.stringify(completedData), "EX", 86400);

  // Persist to Postgres
  await query(
    `UPDATE idempotency_keys 
     SET status = 'COMPLETED', response_status = $1, response_body = $2 
     WHERE key = $3`,
    [statusCode, JSON.stringify(body), key]
  );
}

export async function clearIdempotencyLock(key: string): Promise<void> {
  await redis.del(`idempotency:${key}`);
  await query(`DELETE FROM idempotency_keys WHERE key = $1 AND status = 'IN_FLIGHT'`, [key]);
}
