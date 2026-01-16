/**
* This file is not for migrations it's self but more to keep track off all the tables 
* and when they were created
**/


/**
* This is the table that deals with friend requests 07/02/2026
**/
CREATE TABLE IF NOT EXISTS "FriendRequest" (
  id text PRIMARY KEY,
  "requesterId" text NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  "addresseeId" text NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  status text NOT NULL,
  "createdAt" timestamp(3) NOT NULL DEFAULT now(),
  "updatedAt" timestamp(3) NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "FriendRequest_requesterId_idx" ON "FriendRequest" ("requesterId");
CREATE INDEX IF NOT EXISTS "FriendRequest_addresseeId_idx" ON "FriendRequest" ("addresseeId");
CREATE INDEX IF NOT EXISTS "FriendRequest_status_idx" ON "FriendRequest" (status);


/**
* This is the table that deals with a user posting a future session 07/02/2026
**/
CREATE TABLE IF NOT EXISTS "FutureSession" (
  id text PRIMARY KEY,
  "userId" text NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  sport text NOT NULL,
  "time" timestamp(3) NOT NULL,
  location text NOT NULL,
  latitude double precision,
  longitude double precision,
  notes text,
  "createdAt" timestamp(3) NOT NULL DEFAULT now(),
  "updatedAt" timestamp(3) NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "FutureSession_userId_idx" ON "FutureSession" ("userId");
CREATE INDEX IF NOT EXISTS "FutureSession_time_idx" ON "FutureSession" ("time");

/**
* Add coordinates to future sessions (nullable) 09/18/2025
**/
ALTER TABLE IF EXISTS "FutureSession"
  ADD COLUMN IF NOT EXISTS latitude double precision;
ALTER TABLE IF EXISTS "FutureSession"
  ADD COLUMN IF NOT EXISTS longitude double precision;
