import type { Request, Response } from "express";
import { getAuthUserId, getRequiredString, parseNumber } from "../helpers/helperFunctions.js";
import { database } from "../db/db.js";
import { futureSessionComments, futureSessions, users } from '../db/schema.js'
import { randomUUID } from "node:crypto";
import { and, asc, eq, gt, sql } from "drizzle-orm";

const SPORT_OPTIONS = ["kitesurfing", "wingfoiling", "windsurfing", "surfing"];
type Sport = (typeof SPORT_OPTIONS)[number];

type SessionForm = {
  id: string;
  userId: string;
  spotId: string | null;
  sport: Sport;
  time: Date;
  location: string;
  latitude: number | null;
  longitude: number | null;
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

    const session: SessionForm = {
      id: String(Date.now()),
      userId,
      spotId,
      sport,
      time,
      location,
      latitude,
      longitude,
    };

    const id = randomUUID();
    
    //Strore the request into Friend Request table
    await database.insert(futureSessions).values({
      id,
      userId: userId,
      sport: sport,
      time: time,
      location: location,
      spotId,
      latitude,
      longitude,
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
    
    const posts = await database
      .select()
      .from(futureSessions)
      .where(eq(futureSessions.userId, targetUserId))
      .orderBy(asc(futureSessions.time));

    return res.status(200).json({ posts });
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

    return res.status(200).json({ posts });
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

    const posts = (result as { rows?: unknown[] }).rows ?? [];
    return res.status(200).json({ posts });

  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "Server error" });
  }
}
