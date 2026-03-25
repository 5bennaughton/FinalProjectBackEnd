import { config } from "dotenv";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach } from "vitest";

// Load test-only environment variables before any app or DB imports execute.
config({ path: ".env.test" });

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is not set for tests. Add it to backend-project/.env.test"
  );
}

const { database, pool } = await import("../src/db/db.js");

beforeAll(async () => {
  await database.execute(sql`
    CREATE TABLE IF NOT EXISTS "User" (
      "id" text PRIMARY KEY,
      "name" text NOT NULL,
      "bio" text,
      "avatarUrl" text,
      "email" text NOT NULL UNIQUE,
      "password" text NOT NULL,
      "role" text NOT NULL DEFAULT 'user',
      "profileVisibility" text NOT NULL DEFAULT 'public',
      "createdAt" timestamp(3) NOT NULL DEFAULT NOW()
    )
  `);

  await database.execute(sql`
    ALTER TABLE IF EXISTS "User"
      ADD COLUMN IF NOT EXISTS "role" text NOT NULL DEFAULT 'user'
  `);

  await database.execute(sql`
    CREATE TABLE IF NOT EXISTS "FriendRequest" (
      "id" text PRIMARY KEY,
      "requesterId" text NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
      "addresseeId" text NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
      "status" text NOT NULL,
      "createdAt" timestamp(3) NOT NULL DEFAULT NOW(),
      "updatedAt" timestamp(3) NOT NULL DEFAULT NOW()
    )
  `);

  await database.execute(sql`
    CREATE TABLE IF NOT EXISTS "Spot" (
      "id" text PRIMARY KEY,
      "name" text NOT NULL,
      "type" text NOT NULL,
      "latitude" double precision NOT NULL,
      "longitude" double precision NOT NULL,
      "description" text,
      "windDirStart" double precision,
      "windDirEnd" double precision,
      "isTidal" boolean,
      "tidePreference" text,
      "tideWindowHours" double precision,
      "createdBy" text NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
      "createdAt" timestamp(3) NOT NULL DEFAULT NOW(),
      "updatedAt" timestamp(3) NOT NULL DEFAULT NOW()
    )
  `);

  await database.execute(sql`
    CREATE TABLE IF NOT EXISTS "SpotRating" (
      "id" text PRIMARY KEY,
      "spotId" text NOT NULL REFERENCES "Spot"("id") ON DELETE CASCADE,
      "userId" text NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
      "rating" integer NOT NULL,
      "createdAt" timestamp(3) NOT NULL DEFAULT NOW(),
      "updatedAt" timestamp(3) NOT NULL DEFAULT NOW(),
      UNIQUE ("spotId", "userId"),
      CHECK ("rating" >= 1 AND "rating" <= 5)
    )
  `);

  await database.execute(sql`
    CREATE TABLE IF NOT EXISTS "FutureSession" (
      "id" text PRIMARY KEY,
      "userId" text NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
      "spotId" text REFERENCES "Spot"("id") ON DELETE SET NULL,
      "sport" text NOT NULL,
      "time" timestamp(3) NOT NULL,
      "location" text NOT NULL,
      "latitude" double precision,
      "longitude" double precision,
      "notes" text,
      "visibility" text NOT NULL DEFAULT 'public',
      "allowedViewerIds" text[],
      "createdAt" timestamp(3) NOT NULL DEFAULT NOW(),
      "updatedAt" timestamp(3) NOT NULL DEFAULT NOW()
    )
  `);

  await database.execute(sql`
    CREATE TABLE IF NOT EXISTS "FutureSessionComment" (
      "id" text PRIMARY KEY,
      "postId" text NOT NULL REFERENCES "FutureSession"("id") ON DELETE CASCADE,
      "userId" text NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
      "body" text NOT NULL,
      "createdAt" timestamp(3) NOT NULL DEFAULT NOW()
    )
  `);

  await database.execute(sql`
    CREATE TABLE IF NOT EXISTS "UserBlock" (
      "id" text PRIMARY KEY,
      "blockerId" text NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
      "blockedId" text NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
      "createdAt" timestamp(3) NOT NULL DEFAULT NOW(),
      UNIQUE ("blockerId", "blockedId")
    )
  `);
});

beforeEach(async () => {
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
