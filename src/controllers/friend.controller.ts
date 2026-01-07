import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { and, eq, ilike, inArray, ne, or } from "drizzle-orm";
import { database } from "../db/db.js";
import { friendRequests, users } from "../db/schema.js";

const FRIEND_STATUS = {
  PENDING: "pending",
  ACCEPTED: "accepted",
};

type FriendStatus = (typeof FRIEND_STATUS)[keyof typeof FRIEND_STATUS];

// Normalize any input into a trimmed string
function getString(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }

  return "";
}

// Read the authenticated user id (set by auth middleware)
function getAuthUserId(req: Request, res: Response): string | null {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ message: "Unauthorized" });
    return null;
  }
  return userId;
};

// Check if a user exists before creating a request
async function userExists(userId: string) {
  const rows = await database
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return rows.length > 0;
};

// Fetch a request row by id
async function getRequestById(requestId: string) {
  const rows = await database
    .select()
    .from(friendRequests)
    .where(eq(friendRequests.id, requestId))
    .limit(1);
  return rows[0] ?? null;
};

// Check if a request already exists between two users (either direction)
async function getRequestBetweenTwoUsers(userA: string, userB: string) {
  const rows = await database
    .select()
    .from(friendRequests)
    .where(
      or(
        and(
          eq(friendRequests.requesterId, userA),
          eq(friendRequests.addresseeId, userB)
        ),
        and(
          eq(friendRequests.requesterId, userB),
          eq(friendRequests.addresseeId, userA)
        )
      )
    )
    .limit(1);

  return rows[0] ?? null;
};

// Get all accepted friend ids for the current user
async function getFriendIdsForUser(userId: string) {
  const rows = await database
    .select({
      requesterId: friendRequests.requesterId,
      addresseeId: friendRequests.addresseeId,
    })
    .from(friendRequests)
    .where(
      and(
        eq(friendRequests.status, FRIEND_STATUS.ACCEPTED),
        or(
          eq(friendRequests.requesterId, userId),
          eq(friendRequests.addresseeId, userId)
        )
      )
    );

  const friendIds: string[] = [];

for (const row of rows) {
  if (row.requesterId === userId) {
    friendIds.push(row.addresseeId);
  } else {
    friendIds.push(row.requesterId);
  }
}

return friendIds;
}

// Search users by name or email, excluding the current user
export async function searchUsers(req: Request, res: Response) {
  try {
    const userId = getAuthUserId(req, res);
    if (!userId) return;

    const query = getString(req.query.q);
    if (!query) {
      return res.status(400).json({ message: "q is required" });
    }

    // Case-insensitive search on name or email to users db
    const matches = await database
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(
        and(
          or(
            ilike(users.name, `%${query}%`),
            ilike(users.email, `%${query}%`)
          ),
          ne(users.id, userId)
        )
      )
      .limit(20);

    return res.status(200).json({ users: matches });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  }
};

// Create a pending friend request
export async function createFriendRequest(req: Request, res: Response) {
  try {
    const userId = getAuthUserId(req, res);
    if (!userId) return;

    const addresseeId = getString(req.body?.addresseeId);
    if (!addresseeId) {
      return res.status(400).json({ message: "addresseeId is required" });
    }

    if (addresseeId === userId) {
      return res.status(400).json({ message: "Cannot send a friend request to yourself" });
    }

    if (!(await userExists(addresseeId))) {
      return res.status(404).json({ message: "User not found" });
    }

    // Prevent duplicate requests in either direction
    const existing = await getRequestBetweenTwoUsers(userId, addresseeId);

    if (existing) {
      const status = existing.status as FriendStatus;
      if (status === FRIEND_STATUS.ACCEPTED) {
        return res.status(409).json({ message: "You are already friends" });
      }
      return res.status(409).json({ message: "Friend request already pending" });
    }

    
    const id = randomUUID();

    //Strore the request into thr DB
    await database.insert(friendRequests).values({
      id,
      requesterId: userId,
      addresseeId,
      status: FRIEND_STATUS.PENDING,
    });

    return res.status(201).json({
      request: {
        id,
        requesterId: userId,
        addresseeId,
        status: FRIEND_STATUS.PENDING,
      },
    });

  } catch (err) {
    return res.status(500).json({ message: "Server error" });
  }
};

// List pending requests (incoming/outgoing/all)
export async function listFriendRequests(req: Request, res: Response) {
  try {
    const userId = getAuthUserId(req, res);
    if (!userId) return;

    const type = getString(req.query.type);

    const scope =
      type === "incoming"
        ? eq(friendRequests.addresseeId, userId)
        : type === "outgoing"
          ? eq(friendRequests.requesterId, userId)
          : or(
              eq(friendRequests.requesterId, userId),
              eq(friendRequests.addresseeId, userId)
            );

    const requests = await database
      .select()
      .from(friendRequests)
      .where(and(eq(friendRequests.status, FRIEND_STATUS.PENDING), scope))
      .limit(50);

    return res.status(200).json({ requests });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  }
}

// Accept or decline a pending friend request
export async function respondToFriendRequest(req: Request, res: Response) {
  try {
    const userId = getAuthUserId(req, res);
    if (!userId) return;

    const requestId = getString(req.params.id);
    if (!requestId) {
      return res.status(400).json({ message: "Request id is required" });
    }

    const action = getString(req.body?.action);
    if (action !== "accept" && action !== "decline") {
      return res.status(400).json({ message: "Action must be accept or decline" });
    }

    const request = await getRequestById(requestId);
    if (!request) {
      return res.status(404).json({ message: "Friend request not found" });
    }

    if (request.addresseeId !== userId) {
      return res.status(403).json({ message: "Not allowed to respond to this request" });
    }

    if (request.status !== FRIEND_STATUS.PENDING) {
      return res.status(400).json({ message: "Request is not pending" });
    }

    // Accept updates status; decline deletes the row
    if (action === "accept") {
      const updated = await database
        .update(friendRequests)
        .set({ status: FRIEND_STATUS.ACCEPTED, updatedAt: new Date() })
        .where(eq(friendRequests.id, requestId))
        .returning();

      return res.status(200).json({ request: updated[0] });
    }

    await database.delete(friendRequests).where(eq(friendRequests.id, requestId));
    return res.status(200).json({ message: "Friend request declined" });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  }
};

// List accepted friends for the current user
export async function listFriends(req: Request, res: Response) {
  try {
    const userId = getAuthUserId(req, res);
    if (!userId) return;

    const friendIds = await getFriendIdsForUser(userId);
    const uniqueIds = Array.from(new Set(friendIds));

    if (uniqueIds.length === 0) {
      return res.status(200).json({ friends: [] });
    }

    const friends = await database
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(inArray(users.id, uniqueIds));

    return res.status(200).json({ friends });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  }
}
