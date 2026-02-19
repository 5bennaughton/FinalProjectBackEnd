import type { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { and, eq, ilike } from "drizzle-orm";
import { database } from "../db/db.js";
import { spots } from "../db/schema.js";
import { getAuthUserId, getRequiredString, parseNumber } from "../helpers/helperFunctions.js";

type SpotPayload = {
  name: string;
  type: string;
  latitude: number;
  longitude: number;
  description: string | null;
  windDirStart?: number | null;
  windDirEnd?: number | null;
  isTidal?: boolean | null;
  tidePreference?: "high" | "low" | null;
  tideWindowHours?: number | null;
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

    // Optional description (we keep it nullable if missing).
    const description =
      typeof req.body?.description === "string"
        ? req.body.description.trim()
        : null;

    /**
     * Optional wind direction + tidal fields.
     * We only validate them if the user actually provided a value.
     */
    const windDirStartRaw = req.body?.windDirStart;
    const windDirStart = parseNumber(windDirStartRaw);
    if (
      windDirStartRaw !== undefined &&
      windDirStartRaw !== null &&
      windDirStartRaw !== "" &&
      windDirStart === null
    ) {
      return res.status(400).json({ message: "windDirStart must be a number" });
    }

    const windDirEndRaw = req.body?.windDirEnd;
    const windDirEnd = parseNumber(windDirEndRaw);
    if (
      windDirEndRaw !== undefined &&
      windDirEndRaw !== null &&
      windDirEndRaw !== "" &&
      windDirEnd === null
    ) {
      return res.status(400).json({ message: "windDirEnd must be a number" });
    }

    // If one direction is set, require the other as well.
    if ((windDirStart !== null && windDirEnd === null) || (windDirStart === null && windDirEnd !== null)) {
      return res.status(400).json({ message: "windDirStart and windDirEnd must both be provided" });
    }

    // If provided, direction values must be within 0-359.
    if (
      windDirStart !== null &&
      (windDirStart < 0 || windDirStart > 359)
    ) {
      return res.status(400).json({ message: "windDirStart must be between 0 and 359" });
    }
    if (windDirEnd !== null && (windDirEnd < 0 || windDirEnd > 359)) {
      return res.status(400).json({ message: "windDirEnd must be between 0 and 359" });
    }

    // Basic tidal flag (true/false). If missing, it stays null.
    let isTidal: boolean | null = null;
    if (typeof req.body?.isTidal === "boolean") {
      isTidal = req.body.isTidal;
    } else if (typeof req.body?.isTidal === "string") {
      const raw = req.body.isTidal.trim().toLowerCase();
      if (raw === "true") isTidal = true;
      if (raw === "false") isTidal = false;
    }

    /**
     * Optional tide settings for future "kiteable" checks.
     * Allowed values are intentionally small and explicit.
     */
    let tidePreference: "high" | "low" | null = null;

    if (typeof req.body?.tidePreference === "string") {
      const raw = req.body.tidePreference.trim().toLowerCase();

      if (raw === "high" || raw === "low") {
        tidePreference = raw;
      } else if (raw) {
        return res.status(400).json({ message: "tidePreference must be high, low" });
      }
    }

    const tideWindowHoursRaw = req.body?.tideWindowHours;
    const tideWindowHours = parseNumber(tideWindowHoursRaw);

    if (
      tideWindowHoursRaw !== undefined &&
      tideWindowHoursRaw !== null &&
      tideWindowHoursRaw !== "" &&
      tideWindowHours === null
    ) {
      return res.status(400).json({ message: "tideWindowHours must be a number" });
    }
    if (tideWindowHours !== null && tideWindowHours < 0) {
      return res.status(400).json({ message: "tideWindowHours must be 0 or greater" });
    }

    const id = randomUUID();
    
    const payload: SpotPayload = {
      name,
      type,
      latitude,
      longitude,
      description,
      windDirStart,
      windDirEnd,
      isTidal,
      tidePreference,
      tideWindowHours,
    };

    await database.insert(spots).values({
      id,
      ...payload,
      createdBy: userId,
    });

    // Return the stored spot so the client has all new fields.
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
        windDirStart: spots.windDirStart,
        windDirEnd: spots.windDirEnd,
        isTidal: spots.isTidal,
        tidePreference: spots.tidePreference,
        tideWindowHours: spots.tideWindowHours,
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

/**
 * Delete a spot by id for the authenticated user.
 * Verifies ownership and returns 404 when not found.
 */
export async function deleteSpot(req: Request, res: Response) {
  try {
    const userId = getAuthUserId(req, res);
    if (!userId) return;

    const spotId = typeof req.params.id === "string" ? req.params.id.trim() : "";
    if (!spotId) return res.status(400).json({ message: "Spot id is required" });

    const deleted = await database
      .delete(spots)
      .where(and(eq(spots.id, spotId), eq(spots.createdBy, userId)))
      .returning({ id: spots.id });

    if (deleted.length === 0) {
      return res.status(404).json({ message: "Spot not found" });
    }

    return res.status(200).json({ message: "Spot deleted" });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Server error" });
  }
}
