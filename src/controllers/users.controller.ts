import type { Request, Response } from "express";
import { eq } from "drizzle-orm";
import { database } from "../db/db.js";
import { users } from "../db/schema.js";
import { getAuthUserId } from "../helpers/helperFunctions.js";

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

    const found = await database
      .select({
        id: users.id,
        name: users.name,
        bio: users.bio,
        avatarUrl: users.avatarUrl,
      })
      .from(users)
      .where(eq(users.id, targetUserId))
      .limit(1);

    const profile = found[0];
    if (!profile) {
      return res.status(404).json({ message: "User not found" });
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
