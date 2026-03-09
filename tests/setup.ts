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
  // Reset data between tests to keep cases isolated and deterministic.
  await database.execute(sql`
    TRUNCATE TABLE
      "FutureSessionComment",
      "FutureSession",
      "SpotRating",
      "Spot",
      "FriendRequest",
      "UserBlock",
      "User"
    RESTART IDENTITY CASCADE
  `);
});

afterAll(async () => {
  await pool.end();
});
