/**
* This file is not for migrations it's self but more to keep track off all the tables 
* and when they were created
**/

/**
* This is the table that deals with friend requests 07/01/2026
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
* This is the table that deals with a user posting a future session 07/01/2026
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
* Add coordinates to future sessions (nullable) 011/01/2026
**/
ALTER TABLE IF EXISTS "FutureSession"
  ADD COLUMN IF NOT EXISTS latitude double precision;
ALTER TABLE IF EXISTS "FutureSession"
  ADD COLUMN IF NOT EXISTS longitude double precision;

/**
* This is the table that deals with comments on future session posts 09/01/2026
**/
CREATE TABLE IF NOT EXISTS "FutureSessionComment" (
  id text PRIMARY KEY,
  "postId" text NOT NULL REFERENCES "FutureSession"(id) ON DELETE CASCADE,
  "userId" text NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  body text NOT NULL,
  "createdAt" timestamp(3) NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "FutureSessionComment_postId_idx" ON "FutureSessionComment" ("postId");
CREATE INDEX IF NOT EXISTS "FutureSessionComment_userId_idx" ON "FutureSessionComment" ("userId");


/**
* Enable PostGIS extension for geo queries 17/01/2026
**/
CREATE EXTENSION IF NOT EXISTS postgis;

/**
* This is the table that deals with user-created spots 18/01/2026
**/
CREATE TABLE IF NOT EXISTS "Spot" (
  id text PRIMARY KEY,
  name text NOT NULL,
  type text NOT NULL,
  latitude double precision NOT NULL,
  longitude double precision NOT NULL,
  description text,
  "createdBy" text NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  "createdAt" timestamp(3) NOT NULL DEFAULT now(),
  "updatedAt" timestamp(3) NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "Spot_type_idx" ON "Spot" (type);
CREATE INDEX IF NOT EXISTS "Spot_createdBy_idx" ON "Spot" ("createdBy");

/**
* Add basic wind direction + tidal fields to spots 07/02/2026
**/
ALTER TABLE IF EXISTS "Spot"
  ADD COLUMN IF NOT EXISTS "windDirStart" double precision;
ALTER TABLE IF EXISTS "Spot"
  ADD COLUMN IF NOT EXISTS "windDirEnd" double precision;
ALTER TABLE IF EXISTS "Spot"
  ADD COLUMN IF NOT EXISTS "isTidal" boolean;

/**
* Add spotId to future sessions (nullable) 20/01/2026
**/
ALTER TABLE IF EXISTS "FutureSession"
  ADD COLUMN IF NOT EXISTS "spotId" text REFERENCES "Spot"(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "FutureSession_spotId_idx" ON "FutureSession" ("spotId");

/**
* Add bio to users 21/01/2026
**/
ALTER TABLE IF EXISTS "User"
  ADD COLUMN IF NOT EXISTS bio text;
ALTER TABLE IF EXISTS "User"
  ADD COLUMN IF NOT EXISTS "avatarUrl" text;

/**
* Add profile visibility to users 24/01/2026
**/
ALTER TABLE IF EXISTS "User"
  ADD COLUMN IF NOT EXISTS "profileVisibility" text NOT NULL DEFAULT 'public';

/**
* Add visibility controls to future sessions 24/01/2026
**/
ALTER TABLE IF EXISTS "FutureSession"
  ADD COLUMN IF NOT EXISTS "visibility" text NOT NULL DEFAULT 'public';
ALTER TABLE IF EXISTS "FutureSession"
  ADD COLUMN IF NOT EXISTS "allowedViewerIds" text[];

CREATE INDEX IF NOT EXISTS "FutureSession_visibility_idx" ON "FutureSession" ("visibility");

/**
* This is the table that deals with user blocks 25/01/2026
**/
CREATE TABLE IF NOT EXISTS "UserBlock" (
  id text PRIMARY KEY,
  "blockerId" text NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  "blockedId" text NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  "createdAt" timestamp(3) NOT NULL DEFAULT now(),
  UNIQUE ("blockerId", "blockedId")
);

CREATE INDEX IF NOT EXISTS "UserBlock_blockerId_idx" ON "UserBlock" ("blockerId");
CREATE INDEX IF NOT EXISTS "UserBlock_blockedId_idx" ON "UserBlock" ("blockedId");

/**
* Add kiteability configuration fields to spots 18/02/2026
* Keep these nullable so older spots continue to work.
**/
ALTER TABLE IF EXISTS "Spot"
  ADD COLUMN IF NOT EXISTS "tidePreference" text;
ALTER TABLE IF EXISTS "Spot"
  ADD COLUMN IF NOT EXISTS "tideWindowHours" double precision;
