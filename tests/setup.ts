import { config } from "dotenv";
import { sql } from "drizzle-orm";
import { afterAll, beforeEach } from "vitest";

// Load test-only environment variables.
config({ path: ".env.test" });

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is not set for tests. Add it to backend-project/.env.test"
  );
}

const { database, pool } = await import("../src/db/db.js");

beforeEach(async () => {
  // Minimal schema bootstrap for the first integration test.
  await database.execute(sql`
    CREATE TABLE IF NOT EXISTS "User" (
      "id" text PRIMARY KEY,
      "name" text NOT NULL,
      "bio" text,
      "avatarUrl" text,
      "email" text NOT NULL UNIQUE,
      "password" text NOT NULL,
      "profileVisibility" text NOT NULL DEFAULT 'public',
      "createdAt" timestamp(3) NOT NULL DEFAULT NOW()
    )
  `);

  // Reset data between tests to keep cases isolated and deterministic.
  await database.execute(sql`
    TRUNCATE TABLE "User" RESTART IDENTITY CASCADE
  `);
});

afterAll(async () => {
  await pool.end();
});
