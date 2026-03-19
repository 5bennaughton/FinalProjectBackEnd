import { eq } from "drizzle-orm";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { database } from "../src/db/db.js";
import { users } from "../src/db/schema.js";
import { authHeaderFor, createUser } from "./helpers.js";

describe("Auth routes", () => {
  it("registers a new user, returns 201, and stores a hashed password", async () => {
    const payload = {
      name: "Test User",
      email: `test-${Date.now()}@example.com`,
      password: "secret123",
    };
    const res = await request(app).post("/auth/register").send(payload);

    // Confirming that the endpoint shows success to the
    expect(res.status).toBe(201);
    expect(res.body.message).toContain("Thanks for signing up");

    // Read the user back from the database so we can verify the route
    // actually created a record and did not store the raw password.
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

    // Assert that the user exists and that the values match expects
    expect(stored.length).toBe(1);
    expect(stored[0]?.name).toBe(payload.name);
    expect(stored[0]?.password).not.toBe(payload.password);
  });

  it("rejects a second registration that reuses an existing email address", async () => {
    const existingUser = await createUser({
      email: "duplicate@example.com",
    });

    // a new registration that reuses the same email
    const res = await request(app).post("/auth/register").send({
      name: "Another User",
      email: existingUser.email,
      password: "secret123",
    });

    // Expect error of 400 with the following error message
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Email already exists");
  });

  it("logs a user in and allows bearer token access to /auth/me", async () => {
    const user = await createUser({
      name: "Logged In User",
      email: "login@example.com",
      password: "super-secret",
    });

    const loginRes = await request(app).post("/auth/login").send({
      email: user.email,
      password: user.plainPassword,
    });

    // Make sure login succeeded and produced a token for auth requests
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.user.email).toBe(user.email);
    expect(loginRes.body.token).toEqual(expect.any(String));

    // Reuse the returned bearer token against a protected route so the test
    // covers both the controller and the auth middleware 
    const meRes = await request(app)
      .get("/auth/me")
      .set("Authorization", `Bearer ${loginRes.body.token}`);

    // Expect the following
    expect(meRes.status).toBe(200);
    expect(meRes.body.name).toBe("Logged In User");
    expect(meRes.body.friendCount).toBe(0);
  });

  it("rejects login attempts when the password is incorrect", async () => {
    // Create a valid user first so the failure is specifically about
    // password mismatch and not about a missing account.
    const user = await createUser({
      email: "wrong-password@example.com",
      password: "correct-password",
    });

    // Send the wrong password to confirm the route returns an auth failure
    const res = await request(app).post("/auth/login").send({
      email: user.email,
      password: "definitely-wrong",
    });

    // The route should reject the password and not return a token
    expect(res.status).toBe(401);
    expect(res.body.message).toBe("Invalid credentials");
  });

  it("rejects protected routes when no authentication token is provided", async () => {
    // Call a protected endpoint without any Authorization header because
    const res = await request(app).get("/auth/me");

    // The middleware should stop the request before the controller runs
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Not authorized, no token provided");
  });

  it("rejects a valid-looking token after the referenced user has been deleted", async () => {
    const user = await createUser({
      email: "deleted-user@example.com",
    });

    // Build a bearer token the same way the application does 
    const headers = authHeaderFor(user.id, user.email);

    // Delete the user before making the request so the middleware has to
    // verify that the token subject still exists in the database
    await database.delete(users).where(eq(users.id, user.id));

    // Use the old token against a protected route.
    const res = await request(app).get("/auth/me").set(headers);

    // The middleware should reject the request because the user no longer exists
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("user no longer exists");
  });
});
