import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { getTestApp, resetDatabase, closeTestResources } from "../test-helper.js";
import { FastifyInstance } from "fastify";

describe("Accounts API", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await getTestApp();
  });

  afterAll(async () => {
    await closeTestResources();
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  it("should create a new user wallet with initial balance 0", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/accounts",
      payload: {
        user_id: "user_test_1",
        currency: "INR",
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.success).toBe(true);
    expect(body.data.user_id).toBe("user_test_1");
    expect(body.data.currency).toBe("INR");
    expect(body.data.type).toBe("USER_WALLET");
    expect(body.data.cached_balance).toBe("0");
    expect(body.data.status).toBe("ACTIVE");
    expect(body.data.id).toBeDefined();
  });

  it("should fetch account balance and empty history initially", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/api/v1/accounts",
      payload: {
        user_id: "user_test_2",
      },
    });

    const accountId = createRes.json().data.id;

    const balanceRes = await app.inject({
      method: "GET",
      url: `/api/v1/accounts/${accountId}/balance`,
    });

    expect(balanceRes.statusCode).toBe(200);
    const body = balanceRes.json();
    expect(body.success).toBe(true);
    expect(body.data.account.balance).toBe("0");
    expect(body.data.history).toHaveLength(0);
    expect(body.data.pagination.total).toBe(0);
  });
});
