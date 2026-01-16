import type { Request, Response } from "express";
import { desc, eq, inArray } from "drizzle-orm";
import { database } from "../db/db.js";
import { futureSessions, users } from "../db/schema.js";
import { getAuthUserId, getFriendIdsForUser } from "../helpers/helperFunctions.js";

export async function listFriendFeed(req: Request, res: Response) {
  try {
    const userId = getAuthUserId(req, res);
    if (!userId) return;

    const friendIds = await getFriendIdsForUser(userId);
    const uniqueFriendIds = Array.from(new Set(friendIds));

    if (uniqueFriendIds.length === 0) {
      return res.status(200).json({ posts: [] });
    }

    const posts = await database
      .select({
        id: futureSessions.id,
        userId: futureSessions.userId,
        userName: users.name,
        sport: futureSessions.sport,
        time: futureSessions.time,
        location: futureSessions.location,
        latitude: futureSessions.latitude,
        longitude: futureSessions.longitude,
        notes: futureSessions.notes,
      })
      .from(futureSessions)
      .innerJoin(users, eq(users.id, futureSessions.userId))
      .where(inArray(futureSessions.userId, uniqueFriendIds))
      .orderBy(desc(futureSessions.time));

    return res.status(200).json({ posts });
    
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  }
}
