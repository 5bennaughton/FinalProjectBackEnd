import type { Request, Response } from "express";
import { getString } from "../controllers/friend.controller.js";
import { database } from "../db/db.js";
import { and, eq, ilike, ne, or } from "drizzle-orm";
import { friendRequests, userBlocks, users } from "../db/schema.js";

/**
 * Read the authenticated user id (set by auth middleware)
 */
export function getAuthUserId(req: Request, res: Response): string | null {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ message: "Unauthorized" });
    return null;
  }
  return userId;
};

/**
 * Search users by name or email, excluding the current user
 */
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
          ilike(users.name, `%${query}%`),
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

/**
 * Get all accepted friend ids for the current user
 */
export async function getFriendIdsForUser(userId: string) {
  const rows = await database
    .select({
      requesterId: friendRequests.requesterId,
      addresseeId: friendRequests.addresseeId,
    })
    .from(friendRequests)
    .where(
      and(
        eq(friendRequests.status, "accepted"),
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

/**
 * Get all user ids that are blocked either direction with the current user.
 * Includes users you blocked and users who blocked you.
 */
export async function getBlockedUserIds(userId: string) {
  const rows = await database
    .select({
      blockerId: userBlocks.blockerId,
      blockedId: userBlocks.blockedId,
    })
    .from(userBlocks)
    .where(
      or(
        eq(userBlocks.blockerId, userId),
        eq(userBlocks.blockedId, userId)
      )
    );

  const blockedIds = new Set<string>();

  for (const row of rows) {
    if (row.blockerId === userId) {
      blockedIds.add(row.blockedId);
    } else if (row.blockedId === userId) {
      blockedIds.add(row.blockerId);
    }
  }

  return Array.from(blockedIds);
}

/**
 * Check if two users have a block relationship in either direction.
 */
export async function isBlockedBetween(userA: string, userB: string) {
  const rows = await database
    .select({ id: userBlocks.id })
    .from(userBlocks)
    .where(
      or(
        and(eq(userBlocks.blockerId, userA), eq(userBlocks.blockedId, userB)),
        and(eq(userBlocks.blockerId, userB), eq(userBlocks.blockedId, userA))
      )
    )
    .limit(1);

  return rows.length > 0;
}

/**
 * Ensures value is a string, then trims the string and returns
 */
export function getRequiredString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/**
 * Parse an optional numeric value. Returns null if empty, undefined if invalid.
 */
export function parseNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed =
    typeof value === "number" ? value : Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}
