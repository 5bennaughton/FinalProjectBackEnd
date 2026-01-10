import type { Request, Response } from "express";
import { getAuthUserId } from "../helpers/helperFunctions.js";
import { database } from "../db/db.js";
import { futureSessions } from '../db/schema.js'
import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";

const SPORT_OPTIONS = ["kitesurfing", "wingfoiling", "windsurfing", "surfing"];
type Sport = (typeof SPORT_OPTIONS)[number];

type SessionForm = {
  id: string;
  userId: string;
  sport: Sport;
  time: Date;
  location: string;
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
 * Read a non-empty string value or return null.
 */
function getRequiredString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/**
 * Create a future session for the authenticated user.
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

    const session: SessionForm = {
      id: String(Date.now()),
      userId,
      sport,
      time,
      location,
    };

    const id = randomUUID();
    
    //Strore the request into Friend Request table
    await database.insert(futureSessions).values({
      id,
      userId: userId,
      sport: sport,
      time: time,
      location: location,
    });

    return res.status(201).json({ session });
    
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Server error" });
  }
}

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

export async function deleteFutureSession(req: Request, res: Response) {
  try {
    const userId = getAuthUserId(req, res);
    if (!userId) return;

    const sessionId = typeof req.params.id === "string" ? req.params.id.trim() : "";

    if (!sessionId) {
      return res.status(400).json({ message: "Session id is required" });
    }

    const deleted = await database
      .delete(futureSessions)
      .where(and(eq(futureSessions.id, sessionId), eq(futureSessions.userId, userId)))
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
