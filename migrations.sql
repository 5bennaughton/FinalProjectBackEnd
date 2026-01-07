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
