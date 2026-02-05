import type { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { ilike } from "drizzle-orm";
import { database } from "../db/db.js";
import { spots } from "../db/schema.js";
import { getAuthUserId, getRequiredString, parseNumber } from "../helpers/helperFunctions.js";

type SpotPayload = {
  name: string;
  type: string;
  latitude: number;
  longitude: number;
  description: string | null;
};

/**
 * Create a new global spot for the authenticated user.
 */
export async function createSpot(req: Request, res: Response) {
  try {
    const userId = getAuthUserId(req, res);
    if (!userId) return;

    const name = getRequiredString(req.body?.name);
    if (!name) return res.status(400).json({ message: "Name is required" });

    const type = getRequiredString(req.body?.type);
    if (!type) return res.status(400).json({ message: "Type is required" });

    const latitude = parseNumber(req.body?.latitude ?? req.body?.lat);
    if (latitude === null) {
      return res.status(400).json({ message: "Latitude is required" });
    }

    const longitude = parseNumber(req.body?.longitude ?? req.body?.lon);
    if (longitude === null) {
      return res.status(400).json({ message: "Longitude is required" });
    }

    const description =
      typeof req.body?.description === "string"
        ? req.body.description.trim()
        : null;

    const id = randomUUID();
    const payload: SpotPayload = {
      name,
      type,
      latitude,
      longitude,
      description,
    };

    await database.insert(spots).values({
      id,
      ...payload,
      createdBy: userId,
    });

    return res.status(201).json({ id, ...payload, createdBy: userId });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Server error" });
  }
}

/**
 * List all global spots.
 */
export async function displaySpots(req: Request, res: Response) {
  try {
    const items = await database.select().from(spots);
    return res.status(200).json({ spots: items });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Server error" });
  }
}

/**
 * Search global spots by name and/or type.
 * Uses a partial match for name/type and returns a small list for autosuggest.
 */
export async function searchSpots(req: Request, res: Response) {
  try {
    const rawQuery = typeof req.query.q === "string" ? req.query.q.trim() : "";

    if (!rawQuery) {
      return res.status(400).json({ message: "q is required" });
    }

    // Means if user types 'bay', the query will accept 
    // bayview, sandy bay, the bay area etc
    const like = `%${rawQuery}%`;

    // Querying the DB for a spot
    const results = await database
      .select({
        id: spots.id,
        name: spots.name,
        type: spots.type,
        latitude: spots.latitude,
        longitude: spots.longitude,
        description: spots.description,
      })
      .from(spots)
      .where(ilike(spots.name, like))
      .limit(20);

    return res.status(200).json({ spots: results });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Server error" });
  }
}
