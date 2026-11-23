import { Redis } from "ioredis";
import { config } from "../config/env.js";

export const redis = new Redis(config.REDIS_URL, {
  maxRetriesPerRequest: 3,
  retryStrategy(times) {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
  lazyConnect: true,
});

redis.on("error", (err) => {
  console.error("Redis connection error:", err.message);
});

redis.on("connect", () => {
  if (config.NODE_ENV !== "test") {
    console.log("Redis connected successfully");
  }
});

export async function connectRedis(): Promise<void> {
  if (redis.status === "wait" || redis.status === "close") {
    await redis.connect();
  }
}

export async function disconnectRedis(): Promise<void> {
  if (redis.status !== "end") {
    await redis.quit();
  }
}
