import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import { database } from "../db/db.js";
import { userBlocks, users } from "../db/schema.js";
import {
  getAuthUserId,
  getFriendIdsForUser,
  isBlockedBetween,
} from "../helpers/helperFunctions.js";

/**
 * Return public profile data for a user.
 */
export async function getUserProfile(req: Request, res: Response) {
  try {
    const userId = getAuthUserId(req, res);
    if (!userId) return;

    const targetUserId = typeof req.params.userId === "string" ? req.params.userId.trim() : "";
    if (!targetUserId) {
      return res.status(400).json({ message: "User id is required" });
    }

    // Always allow the owner to view their own profile.
    if (targetUserId === userId) {
      const self = await database
        .select({
          id: users.id,
          name: users.name,
          bio: users.bio,
          avatarUrl: users.avatarUrl,
          profileVisibility: users.profileVisibility,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      const profile = self[0];
      if (!profile) {
        return res.status(404).json({ message: "User not found" });
      }

      return res.status(200).json({
        id: profile.id,
        name: profile.name,
        bio: profile.bio ?? null,
        avatarUrl: profile.avatarUrl ?? null,
        profileVisibility: profile.profileVisibility ?? "public",
      });
    }

    const found = await database
      .select({
        id: users.id,
        name: users.name,
        bio: users.bio,
        avatarUrl: users.avatarUrl,
        profileVisibility: users.profileVisibility,
      })
      .from(users)
      .where(eq(users.id, targetUserId))
      .limit(1);

    const profile = found[0];
    if (!profile) {
      return res.status(404).json({ message: "User not found" });
    }

    // Blocked users should not be able to view each other's profiles.
    if (await isBlockedBetween(userId, targetUserId)) {
      return res.status(403).json({ message: "Profile not available" });
    }

    const visibility = profile.profileVisibility ?? "public";
    if (visibility === "private") {
      return res.status(403).json({ message: "Profile not available" });
    }

    if (visibility === "friends") {
      const friendIds = await getFriendIdsForUser(userId);
      if (!friendIds.includes(targetUserId)) {
        return res.status(403).json({ message: "Profile not available" });
      }
    }

    return res.status(200).json({
      id: profile.id,
      name: profile.name,
      bio: profile.bio ?? null,
      avatarUrl: profile.avatarUrl ?? null,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  }
}

/**
 * Block a user so their content no longer appears for the requester.
 */
export async function blockUser(req: Request, res: Response) {
  try {
    const userId = getAuthUserId(req, res);
    if (!userId) return;

    const targetUserId = typeof req.params.userId === "string" ? req.params.userId.trim() : "";
    if (!targetUserId) {
      return res.status(400).json({ message: "User id is required" });
    }

    if (targetUserId === userId) {
      return res.status(400).json({ message: "Cannot block yourself" });
    }

    // Ensure the target user exists before creating the block.
    const targetExists = await database
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, targetUserId))
      .limit(1);

    if (targetExists.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    const existing = await database
      .select({ id: userBlocks.id })
      .from(userBlocks)
      .where(
        and(eq(userBlocks.blockerId, userId), eq(userBlocks.blockedId, targetUserId))
      )
      .limit(1);

    if (existing.length > 0) {
      return res.status(200).json({ message: "User already blocked" });
    }

    const id = randomUUID();

    await database.insert(userBlocks).values({
      id,
      blockerId: userId,
      blockedId: targetUserId,
    });

    return res.status(201).json({ message: "User blocked" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  }
}

/**
 * Unblock a previously blocked user.
 */
export async function unblockUser(req: Request, res: Response) {
  try {
    const userId = getAuthUserId(req, res);
    if (!userId) return;

    const targetUserId = typeof req.params.userId === "string" ? req.params.userId.trim() : "";
    if (!targetUserId) {
      return res.status(400).json({ message: "User id is required" });
    }

    const deleted = await database
      .delete(userBlocks)
      .where(
        and(eq(userBlocks.blockerId, userId), eq(userBlocks.blockedId, targetUserId))
      )
      .returning({ id: userBlocks.id });

    if (deleted.length === 0) {
      return res.status(404).json({ message: "Block not found" });
    }

    return res.status(200).json({ message: "User unblocked" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  }
}

/**
 * List users that the current user has blocked.
 */
export async function listBlockedUsers(req: Request, res: Response) {
  try {
    const userId = getAuthUserId(req, res);
    if (!userId) return;

    const blocked = await database
      .select({ id: users.id, name: users.name, email: users.email })
      .from(userBlocks)
      .innerJoin(users, eq(users.id, userBlocks.blockedId))
      .where(eq(userBlocks.blockerId, userId));

    return res.status(200).json({ users: blocked });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  }
}
