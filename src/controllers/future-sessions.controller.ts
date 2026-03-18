import type { Request, Response } from "express";
import {
  getAuthUserId,
  getBlockedUserIds,
  getFriendIdsForUser,
  getRequiredString,
  isBlockedBetween,
  parseNumber,
} from "../helpers/helperFunctions.js";
import { database } from "../db/db.js";
import { futureSessionComments, futureSessions, spots, users } from '../db/schema.js'
import { randomUUID } from "node:crypto";
import { and, asc, eq, gt, sql } from "drizzle-orm";
import { buildSpotHourlyForecast } from "../services/kiteability.service.js";

const SPORT_OPTIONS = ["kitesurfing", "wingfoiling", "windsurfing", "surfing"];
const VISIBILITY_OPTIONS = ["public", "friends", "private", "custom"] as const;
type PostVisibility = (typeof VISIBILITY_OPTIONS)[number];
type Sport = (typeof SPORT_OPTIONS)[number];
const sessionKiteabilityForecastWindowHours = 48;
const sessionKiteabilityDurationHours = 2;

type SessionForm = {
  id: string;
  userId: string;
  spotId: string | null;
  sport: Sport;
  time: Date;
  location: string;
  latitude: number | null;
  longitude: number | null;
  visibility: PostVisibility;
  allowedViewerIds: string[] | null;
};

/**
 * Convert a raw input value into a valid Sport option or null.
 */
function parseSport(value: unknown): Sport | null {
  if (typeof value !== "string") return null;
  const parsed = value.trim().toLowerCase();
  return SPORT_OPTIONS.includes(parsed as Sport) ? (parsed as Sport) : null;
}

/**
 * Parse a date/time string into a Date object or null if invalid.
 */
function parseTime(value: unknown): Date | null {
  if (!value) return null;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Parse a visibility value or default to public.
 */
function parseVisibility(value: unknown): PostVisibility {
  if (typeof value !== "string") return "public";
  const parsed = value.trim().toLowerCase();
  return VISIBILITY_OPTIONS.includes(parsed as PostVisibility)
    ? (parsed as PostVisibility)
    : "public";
}

/**
 * Normalize allowed viewer ids into a string array.
 */
function parseAllowedViewers(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * Normalize stored allowed viewer ids into a string array.
 */
function normalizeAllowedViewerIds(value: unknown) {
  if (Array.isArray(value)) {
    return value.filter((item) => typeof item === "string");
  }

  if (typeof value === "string") {
    const cleaned = value.replace(/[{}]/g, "").trim();
    if (!cleaned) return [];
    return cleaned.split(",").map((item) => item.trim()).filter(Boolean);
  }

  return [];
}

/**
 * Check if a post is visible to a viewer based on visibility rules.
 */
function canViewPost(
  post: { userId?: string; visibility?: string; allowedViewerIds?: string[] | null },
  viewerId: string,
  friendIds: Set<string>
) {
  if (post.userId === viewerId) return true;

  const visibility = (post.visibility ?? "public") as PostVisibility;
  if (visibility === "public") return true;
  if (visibility === "private") return false;
  if (visibility === "friends") {
    return post.userId ? friendIds.has(post.userId) : false;
  }
  if (visibility === "custom") {
    const allowed = Array.isArray(post.allowedViewerIds)
      ? post.allowedViewerIds
      : [];
    return allowed.includes(viewerId);
  }
  return false;
}

/**
 * Load a post and check if the viewer can see it.
 * Returns the post when visible, otherwise null.
 */
async function getVisiblePostForViewer(postId: string, viewerId: string) {
  const rows = await database
    .select()
    .from(futureSessions)
    .where(eq(futureSessions.id, postId))
    .limit(1);

  const post = rows[0];
  if (!post) return null;

  if (await isBlockedBetween(viewerId, post.userId)) {
    return null;
  }

  const friendIds = await getFriendIdsForUser(viewerId);
  const friendSet = new Set(friendIds);

  return canViewPost(post, viewerId, friendSet) ? post : null;
}

/**
 * Check whether a session is kiteable or not.
 */
function getSessionKiteabilityAvailability(session: {
  time: Date;
  spotId?: string | null;
}) {
  if (!session.spotId) {
    return {
      eligible: false as const,
    };
  }

  const sessionStart = new Date(session.time);
  const now = new Date();
  const hoursUntilStart =
    (sessionStart.getTime() - now.getTime()) / (1000 * 60 * 60);

  if (hoursUntilStart < 0) {
    return {
      eligible: false as const,
    };
  }

  if (hoursUntilStart > sessionKiteabilityForecastWindowHours) {
    return {
      eligible: false as const,
    };
  }

  return { eligible: true as const };
}

/**
 * Return true when the linked spot has the wind and tide configuration
 * required to evaluate kiteability for a session.
 */
function getSpotKiteabilityAvailability(spot: {
  windDirStart: number | null;
  windDirEnd: number | null;
  isTidal: boolean | null;
  tidePreference: string | null;
  tideWindowHours: number | null;
}) {
  if (spot.windDirStart === null || spot.windDirEnd === null) {
    return {
      eligible: false as const,
    };
  }

  if (spot.isTidal === true) {
    const hasTidePreference =
      typeof spot.tidePreference === "string" &&
      spot.tidePreference.trim().length > 0;
    const hasTideWindow =
      typeof spot.tideWindowHours === "number" &&
      Number.isFinite(spot.tideWindowHours);

    if (!hasTidePreference || !hasTideWindow) {
      return {
        eligible: false as const,
      };
    }
  }

  return { eligible: true as const };
}

/**
 * Evaluate the fixed two-hour window starting at the session time.
 * A session counts as kiteable when at least one forecast hour passes.
 */
function evaluateSessionWindowForecast(
  sessionStart: Date,
  forecast: Array<{
    time: string;
    speedKn: number;
    directionDeg: number;
    directionOk: boolean;
    speedOk: boolean;
    tideOk: boolean;
    kiteable: boolean;
  }>
) {
  const sessionEnd = new Date(
    sessionStart.getTime() + sessionKiteabilityDurationHours * 60 * 60 * 1000
  );

  // Keep only the forecast hours that fall inside the planned session window.
  const windowForecast = forecast.filter((hour) => {
    const hourTime = new Date(hour.time);
    if (Number.isNaN(hourTime.getTime())) return false;

    return hourTime >= sessionStart && hourTime < sessionEnd;
  });

  const kiteableHours = windowForecast.filter((hour) => hour.kiteable).length;

  return {
    sessionEnd,
    windowForecast,
    kiteableHours,
    status:
      kiteableHours > 0
        ? ("kiteable" as const)
        : ("not_kiteable" as const),
  };
}

/**
 * Create a future session for the authenticated user.
 * Validates sport, time, location, and optional coordinates before insert.
 */
export async function postFutureSession(req: Request, res: Response) {
  try {
    const userId = getAuthUserId(req, res);
    if (!userId) return;

    const sport = parseSport(req.body?.sport);
    if (sport === null) {
      return res.status(400).json({
        message: `Invalid sport value. Use one of: ${SPORT_OPTIONS.join(", ")}`,
      });
    }

    const time = parseTime(req.body?.time);
    if (!time) {
      return res.status(400).json({ message: "Invalid time value" });
    }

    const location = getRequiredString(req.body?.location);
    if (!location) {
      return res.status(400).json({ message: "Location is required" });
    }

    const rawSpotId =
      typeof req.body?.spotId === "string" ? req.body.spotId.trim() : "";
    const spotId = rawSpotId || null;

    const latitude = parseNumber(req.body?.latitude ?? req.body?.lat);
    if (latitude === undefined) {
      return res.status(400).json({ message: "Invalid latitude value" });
    }

    const longitude = parseNumber(req.body?.longitude ?? req.body?.lon);
    if (longitude === undefined) {
      return res.status(400).json({ message: "Invalid longitude value" });
    }

    const visibility = parseVisibility(req.body?.visibility);
    const allowedViewerIds = parseAllowedViewers(req.body?.allowedViewerIds);

    if (visibility === "custom" && allowedViewerIds.length === 0) {
      return res.status(400).json({ message: "allowedViewerIds is required for custom visibility" });
    }

    const session: SessionForm = {
      id: String(Date.now()),
      userId,
      spotId,
      sport,
      time,
      location,
      latitude,
      longitude,
      visibility,
      allowedViewerIds: visibility === "custom" ? allowedViewerIds : null,
    };

    const id = randomUUID();
    
    // Store the future session post.
    await database.insert(futureSessions).values({
      id,
      userId: userId,
      sport: sport,
      time: time,
      location: location,
      spotId,
      latitude,
      longitude,
      visibility,
      allowedViewerIds: visibility === "custom" ? allowedViewerIds : null,
    });

    return res.status(201).json({ session });
    
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Server error" });
  }
}

/**
 * List future sessions for the target user (param or auth user).
 * Orders results by session time ascending.
 */
export async function listPosts(req: Request, res: Response) {
  try {
    const authUserId = getAuthUserId(req, res);
    if (!authUserId) return;

    const paramUserId = typeof req.params.userId === "string" ? req.params.userId.trim() : "";
    const targetUserId = paramUserId || authUserId;

    if (targetUserId !== authUserId) {
      // Do not expose posts when users are blocked from each other.
      if (await isBlockedBetween(authUserId, targetUserId)) {
        return res.status(403).json({ message: "Not allowed to view posts" });
      }
    }
    
    const posts = await database
      .select()
      .from(futureSessions)
      .where(eq(futureSessions.userId, targetUserId))
      .orderBy(asc(futureSessions.time));

    // Owners can always see their own posts.
    if (targetUserId === authUserId) {
      return res.status(200).json({ posts });
    }

    // Filter posts by visibility rules for non-owners.
    const friendIds = await getFriendIdsForUser(authUserId);
    const friendSet = new Set(friendIds);
    const filtered = posts.filter((post) =>
      canViewPost(post, authUserId, friendSet)
    );

    return res.status(200).json({ posts: filtered });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "Server error" }); 
  }
}

/**
 * List future sessions for a spot id, filtered to those after a timestamp.
 * Defaults to sessions after the current time when no `after` param is provided.
 */
export async function listPostsAtSpot(req: Request, res: Response) {
  try {
    const authUserId = getAuthUserId(req, res);
    if (!authUserId) return;

    const spotId =
      typeof req.params.spotId === "string" ? req.params.spotId.trim() : "";
    if (!spotId) {
      return res.status(400).json({ message: "Spot id is required" });
    }

    const afterRaw = req.query.after ?? req.query.time;
    let after = new Date();

    if (afterRaw !== undefined) {
      const parsed = parseTime(afterRaw);
      if (!parsed) {
        return res.status(400).json({ message: "Invalid after value" });
      }
      after = parsed;
    }

    const posts = await database
      .select({
        futureSessions,
        userName: users.name,
      })
      .from(futureSessions)
      .innerJoin(users, eq(users.id, futureSessions.userId))
      .where(
        and(eq(futureSessions.spotId, spotId), gt(futureSessions.time, after))
      )
      .orderBy(asc(futureSessions.time));

    const blockedIds = await getBlockedUserIds(authUserId);
    const blockedSet = new Set(blockedIds);
    const friendIds = await getFriendIdsForUser(authUserId);
    const friendSet = new Set(friendIds);

    // Filter out blocked users and non-visible posts.
    const filtered = posts.filter(({ futureSessions }) => {
      if (futureSessions?.userId && blockedSet.has(futureSessions.userId)) {
        return false;
      }
      return canViewPost(futureSessions, authUserId, friendSet);
    });

    return res.status(200).json({ posts: filtered });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "Server error" });
  }
}

/**
 * Delete a future session by id for the authenticated user.
 * Verifies ownership and returns 404 when not found.
 */
export async function deleteFutureSession(req: Request, res: Response) {
  try {
    const authUserId = getAuthUserId(req, res);
    if (!authUserId) return;

    const sessionId = typeof req.params.id === "string" ? req.params.id.trim() : "";
    if (!sessionId) return res.status(400).json({ message: "Session id is required" });

    const deleted = await database
      .delete(futureSessions)
      .where(and(eq(futureSessions.id, sessionId), eq(futureSessions.userId, authUserId)))
      .returning({ id: futureSessions.id });

    if (deleted.length === 0) {
      return res.status(404).json({ message: "Future session not found" });
    }

    return res.status(200).json({ message: "Future session deleted" });
    
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "Server error" });
  }
}

/**
 * Add a comment to a future session post.
 * Requires an authenticated user and a non-empty body.
 */
export async function addComment(req: Request, res: Response) {
  try {
    const userId = getAuthUserId(req, res);
    if (!userId) return;

    const postId = typeof req.params.id === "string" ? req.params.id.trim() : "";
    if (!postId) return res.status(400).json({ message: "Session id required" });

    // Ensure the user can view the post before commenting.
    const visiblePost = await getVisiblePostForViewer(postId, userId);
    if (!visiblePost) {
      return res.status(403).json({ message: "Not allowed to comment on this post" });
    }

    const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
    if (!body) return res.status(400).json({ message: "Comment body required" });

    const id = randomUUID();

    await database.insert(futureSessionComments).values({
      id,
      postId,
      userId,
      body 
    });
    
    return res.status(201).json({ id, postId, userId, body });

  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "Server error" });
  }
}

/**
 * List comments for a future session post in chronological order.
 * Returns an empty list when no comments exist.
 */
export async function displayComments(req: Request, res: Response) {
  try {
    const userId = getAuthUserId(req, res);
    if (!userId) return;

    const postId = typeof req.params.id === "string" ? req.params.id.trim() : "";
    if (!postId) return res.status(400).json({ message: "Session id required" });

    // Ensure the user can view the post before showing comments.
    const visiblePost = await getVisiblePostForViewer(postId, userId);
    if (!visiblePost) {
      return res.status(403).json({ message: "Not allowed to view comments" });
    }

    const comments = await database
      .select({
        id: futureSessionComments.id,
        postId: futureSessionComments.postId,
        userId: futureSessionComments.userId,
        body: futureSessionComments.body,
        createdAt: futureSessionComments.createdAt,
        userName: users.name,
      })
      .from(futureSessionComments)
      .innerJoin(users, eq(users.id, futureSessionComments.userId))
      .where(eq(futureSessionComments.postId, postId))
      .orderBy(asc(futureSessionComments.createdAt));
    
    return res.status(200).json({ comments });

  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "Server error" });
  }
}

/**
 * Delete a comment for a future session post.
 * Requires the authenticated user to own the comment.
 */
export async function deleteComment(req: Request, res: Response) {
  try {
    const userId = getAuthUserId(req, res);
    if (!userId) return;

    const postId = typeof req.params.id === "string" ? req.params.id.trim() : "";
    if (!postId) return res.status(400).json({ message: "Session id required" });

    const commentId =
      typeof req.params.commentId === "string" ? req.params.commentId.trim() : "";
    if (!commentId) {
      return res.status(400).json({ message: "Comment id required" });
    }

    const deleted = await database
      .delete(futureSessionComments)
      .where(
        and(
          eq(futureSessionComments.id, commentId),
          eq(futureSessionComments.postId, postId),
          eq(futureSessionComments.userId, userId)
        )
      )
      .returning({ id: futureSessionComments.id });

    if (deleted.length === 0) {
      return res.status(404).json({ message: "Comment not found" });
    }

    return res.status(200).json({ message: "Comment deleted" });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "Server error" });
  }
}

/**
 * List future sessions within a radius (km) of the provided coordinates.
 * Uses PostGIS ST_DWithin with a geography point for accurate distances.
 */
export async function listNearbySessions(req: Request, res: Response) {
  try {
    const userId = getAuthUserId(req, res);
    if (!userId) return;

    const latitude = parseNumber(req.query.lat ?? req.query.latitude);

    if (latitude === null || latitude === undefined) {
      return res.status(400).json({ message: "Latitude is required" });
    }

    const longitude = parseNumber( req.query.lng ?? req.query.lon ?? req.query.longitude );

    if (longitude === null || longitude === undefined) {
      return res.status(400).json({ message: "Longitude is required" });
    }

    const radiusRaw = parseNumber(req.query.radiusKm ?? req.query.radius);
    if (radiusRaw === undefined) {
      return res.status(400).json({ message: "Invalid radius value" });
    }

    const radiusKm = radiusRaw ?? 10;
    if (radiusKm <= 0) {
      return res.status(400).json({ message: "Radius must be greater than 0" });
    }

    // SQL that will find posts that are within 'radiusKm'
    const result = await database.execute(sql`
      SELECT
        "FutureSession"."id",
        "FutureSession"."userId",
        "User"."name" AS "userName",
        "FutureSession"."spotId",
        "FutureSession"."sport",
        "FutureSession"."time",
        "FutureSession"."location",
        "FutureSession"."latitude",
        "FutureSession"."longitude",
        "FutureSession"."notes",
        "FutureSession"."visibility",
        "FutureSession"."allowedViewerIds",
        "FutureSession"."createdAt",
        "FutureSession"."updatedAt"
      FROM "FutureSession"
      INNER JOIN "User"
        ON "User"."id" = "FutureSession"."userId"
      WHERE "FutureSession"."latitude" IS NOT NULL
        AND "FutureSession"."longitude" IS NOT NULL
        AND ST_DWithin(
          ST_SetSRID(
            ST_MakePoint("FutureSession"."longitude", "FutureSession"."latitude"),
            4326
          )::geography,
          ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)::geography,
          ${radiusKm} * 1000
        )
      ORDER BY "FutureSession"."time" ASC
    `);

    const posts = (result as { rows?: any[] }).rows ?? [];

    const blockedIds = await getBlockedUserIds(userId);
    const blockedSet = new Set(blockedIds);
    const friendIds = await getFriendIdsForUser(userId);
    const friendSet = new Set(friendIds);

    // Filter out blocked users and non-visible posts.
    const filtered = posts.filter((post) => {
      if (post?.userId && blockedSet.has(post.userId)) {
        return false;
      }

      const allowedViewerIds = normalizeAllowedViewerIds(post.allowedViewerIds);

      return canViewPost(
        {
          userId: post.userId,
          visibility: post.visibility,
          allowedViewerIds,
        },
        userId,
        friendSet
      );
    });

    return res.status(200).json({ posts: filtered });

  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "Server error" });
  }
}

/**
 * Evaluate whether the next fixed two-hour window of a planned session has
 * at least one kiteable forecast hour.
 */
export async function getSessionKiteability(req: Request, res: Response) {
  try {
    const userId = getAuthUserId(req, res);
    if (!userId) return;

    const sessionId =
      typeof req.params.id === "string" ? req.params.id.trim() : "";
    if (!sessionId) {
      return res.status(400).json({ message: "Session id is required" });
    }

    // Reuse the existing privacy checks so only viewers who can see the
    // session can also see the session kiteability result.
    const session = await getVisiblePostForViewer(sessionId, userId);
    if (!session) {
      return res.status(404).json({
        message: "Future session not found or not available",
      });
    }

    const sessionAvailability = getSessionKiteabilityAvailability(session);
    if (!sessionAvailability.eligible) {
      return res.status(200).json({
        eligible: false,
        status: "unavailable",
      });
    }

    const spot = await database
      .select({
        id: spots.id,
        name: spots.name,
        latitude: spots.latitude,
        longitude: spots.longitude,
        windDirStart: spots.windDirStart,
        windDirEnd: spots.windDirEnd,
        isTidal: spots.isTidal,
        tidePreference: spots.tidePreference,
        tideWindowHours: spots.tideWindowHours,
      })
      .from(spots)
      .where(eq(spots.id, session.spotId as string))
      .limit(1);

    const linkedSpot = spot[0];
    if (!linkedSpot) {
      return res.status(200).json({
        eligible: false,
        status: "unavailable",
      });
    }

    const spotAvailability = getSpotKiteabilityAvailability(linkedSpot);
    if (!spotAvailability.eligible) {
      return res.status(200).json({
        eligible: false,
        status: "unavailable",
      });
    }

    const sessionStart = new Date(session.time);
    const now = new Date();
    const sessionEnd = new Date(
      sessionStart.getTime() + sessionKiteabilityDurationHours * 60 * 60 * 1000
    );
    const hoursNeeded = Math.max(
      1,
      Math.ceil((sessionEnd.getTime() - now.getTime()) / (1000 * 60 * 60))
    );

    let forecastResult;
    try {
      // Reuse the exact same spot forecast rules that already power the
      // spot details screen so session kiteability stays consistent.
      forecastResult = await buildSpotHourlyForecast(linkedSpot, hoursNeeded);
    } catch (error) {
      console.error(error);
      return res.status(502).json({
        message: "Failed to fetch session kiteability forecast",
      });
    }

    const windowResult = evaluateSessionWindowForecast(
      sessionStart,
      forecastResult.forecast
    );

    return res.status(200).json({
      eligible: true,
      status: windowResult.status,
      sessionId: session.id,
      spotId: linkedSpot.id,
      spotName: linkedSpot.name,
      windowStart: sessionStart.toISOString(),
      windowEnd: windowResult.sessionEnd.toISOString(),
      hoursChecked: windowResult.windowForecast.length,
      kiteableHours: windowResult.kiteableHours,
      windowForecast: windowResult.windowForecast,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Server error" });
  }
}
