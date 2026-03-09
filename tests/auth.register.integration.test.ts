import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { database } from "../src/db/db.js";
import { users } from "../src/db/schema.js";
import { eq } from "drizzle-orm";

describe("POST /auth/register", () => {
  it("creates a user and returns 201", async () => {
    const payload = {
      name: "Test User",
      email: `test-${Date.now()}@example.com`,
      password: "secret123",
    };

    const res = await request(app).post("/auth/register").send(payload);

    expect(res.status).toBe(201);
    expect(res.body.message).toContain("Thanks for signing up");

    const stored = await database
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        password: users.password,
      })
      .from(users)
      .where(eq(users.email, payload.email))
      .limit(1);

    expect(stored.length).toBe(1);
    expect(stored[0]?.name).toBe(payload.name);
    expect(stored[0]?.password).not.toBe(payload.password);
  });
});
