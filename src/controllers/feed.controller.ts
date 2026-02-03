import type { Request, Response } from "express";
import { desc, eq, inArray } from "drizzle-orm";
import { database } from "../db/db.js";
import { futureSessions, users } from "../db/schema.js";
import {
  getAuthUserId,
  getBlockedUserIds,
  getFriendIdsForUser,
} from "../helpers/helperFunctions.js";

const VISIBILITY = {
  PUBLIC: "public",
  FRIENDS: "friends",
  PRIVATE: "private",
  CUSTOM: "custom",
} as const;

type PostVisibility = (typeof VISIBILITY)[keyof typeof VISIBILITY];

/**
 * Check if a post is visible to the viewer based on visibility rules.
 */
function canViewPost(
  post: { userId?: string; visibility?: string; allowedViewerIds?: string[] | null },
  viewerId: string,
  friendIds: Set<string>
) {
  if (post.userId === viewerId) return true;

  const visibility = (post.visibility ?? VISIBILITY.PUBLIC) as PostVisibility;

  if (visibility === VISIBILITY.PUBLIC) return true;
  if (visibility === VISIBILITY.PRIVATE) return false;
  if (visibility === VISIBILITY.FRIENDS) {
    return post.userId ? friendIds.has(post.userId) : false;
  }

  if (visibility === VISIBILITY.CUSTOM) {
    const allowed = Array.isArray(post.allowedViewerIds)
      ? post.allowedViewerIds
      : [];
    return allowed.includes(viewerId);
  }

  return false;
}

/**
 * List posts from the authenticated user's friends.
 * Joins user data and returns latest posts first.
 */
export async function listFriendFeed(req: Request, res: Response) {
  try {
    const userId = getAuthUserId(req, res);
    if (!userId) return;

    const friendIds = await getFriendIdsForUser(userId);
    const uniqueFriendIds = Array.from(new Set(friendIds));

    const blockedIds = await getBlockedUserIds(userId);
    const blockedSet = new Set(blockedIds);

    // Remove blocked users from the friend list before querying posts.
    const visibleFriendIds = uniqueFriendIds.filter(
      (id) => !blockedSet.has(id)
    );

    if (visibleFriendIds.length === 0) {
      return res.status(200).json({ posts: [] });
    }

    const posts = await database
      .select({
        futureSessions,
        userName: users.name
      })
      .from(futureSessions)
      .innerJoin(users, eq(users.id, futureSessions.userId))
      .where(inArray(futureSessions.userId, visibleFriendIds))
      .orderBy(desc(futureSessions.time));

    const friendIdSet = new Set(visibleFriendIds);

    // Filter posts by visibility and custom audience rules.
    const filtered = posts.filter(({ futureSessions }) =>
      canViewPost(futureSessions, userId, friendIdSet)
    );

    return res.status(200).json({ posts: filtered });
    
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  }
}
