import type { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { and, eq, ilike, sql } from "drizzle-orm";
import { database } from "../db/db.js";
import { spotRatings, spots } from "../db/schema.js";
import {
  getAuthUserId,
  getRequiredString,
  parseNumber,
} from "../helpers/helperFunctions.js";
import {
  buildSpotHourlyForecast,
  type DirectionMode,
} from "../services/kiteability.service.js";

type SpotPayload = {
  name: string;
  type: string;
  latitude: number;
  longitude: number;
  description: string | null;
  windDirStart?: number | null;
  windDirEnd?: number | null;
  isTidal?: boolean | null;
  tidePreference?: string | null;
  tideWindowHours?: number | null;
};

type SpotRatingSummary = {
  spotId: string;
  averageRating: number | null;
  ratingCount: number;
  myRating: number | null;
};

/**
 * Reads direction mode from query params and falls back to shortest-arc mode.
 */
function parseDirectionMode(raw: unknown): DirectionMode | undefined {
  if (typeof raw !== "string") return undefined;
  const value = raw.trim().toLowerCase();
  if (value === "clockwise") return "clockwise";
  if (value === "anticlockwise") {
    return "anticlockwise";
  }
  return undefined;
}

/**
 * Read and validate a star rating value (1..5 integer).
 */
function parseStarRating(value: unknown) {
  const parsed = parseNumber(value);
  if (parsed === null) return null;
  if (!Number.isInteger(parsed)) return null;
  if (parsed < 1 || parsed > 5) return null;
  return parsed;
}

/**
 * Load aggregate + current-user rating for one spot.
 */
async function loadSpotRatingSummary(
  spotId: string,
  userId: string
): Promise<SpotRatingSummary> {
  // Gets the average of all ratings on the database for a certian x spot
  const aggregateRows = await database
    .select({
      averageRating: sql<string | null>`avg(${spotRatings.rating})`,
      ratingCount: sql<number>`count(${spotRatings.id})::int`,
    })
    .from(spotRatings)
    .where(eq(spotRatings.spotId, spotId))
    .limit(1);

  const aggregate = aggregateRows[0];

  const myRows = await database
    .select({ rating: spotRatings.rating })
    .from(spotRatings)
    .where(and(eq(spotRatings.spotId, spotId), eq(spotRatings.userId, userId)))
    .limit(1);

  const averageRaw = aggregate?.averageRating ?? null;

  const averageNumber =
    averageRaw === null ? null : Number.parseFloat(String(averageRaw));

  const hasAverage =
    typeof averageNumber === "number" && Number.isFinite(averageNumber);

  return {
    spotId,
    averageRating: hasAverage ? Number(averageNumber.toFixed(1)) : null,
    ratingCount: Number(aggregate?.ratingCount ?? 0),
    myRating: myRows[0]?.rating ?? null,
  };
}

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
    if (
      (windDirStart !== null && windDirEnd === null) ||
      (windDirStart === null && windDirEnd !== null)
    ) {
      return res
        .status(400)
        .json({ message: "windDirStart and windDirEnd must both be provided" });
    }

    // If provided, direction values must be within 0-359.
    if (windDirStart !== null && (windDirStart < 0 || windDirStart > 359)) {
      return res
        .status(400)
        .json({ message: "windDirStart must be between 0 and 359" });
    }
    if (windDirEnd !== null && (windDirEnd < 0 || windDirEnd > 359)) {
      return res
        .status(400)
        .json({ message: "windDirEnd must be between 0 and 359" });
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
        return res
          .status(400)
          .json({ message: "tidePreference must be high, low" });
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
      return res
        .status(400)
        .json({ message: "tideWindowHours must be a number" });
    }
    if (tideWindowHours !== null && tideWindowHours < 0) {
      return res
        .status(400)
        .json({ message: "tideWindowHours must be 0 or greater" });
    }

    if (isTidal) {
      if (!tidePreference) {
        return res
          .status(400)
          .json({ message: "tidePreference is required for tidal spots" });
      }

      if (tideWindowHours === null) {
        return res
          .status(400)
          .json({ message: "tideWindowHours is required for tidal spots" });
      }
    }

    // it says if spot is tidal, keep tide settings, else store as null
    const normalizedTidePreference = isTidal ? tidePreference : null;
    const normalizedTideWindowHours = isTidal ? tideWindowHours : null;

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
      tidePreference: normalizedTidePreference,
      tideWindowHours: normalizedTideWindowHours,
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

    const spotId =
      typeof req.params.id === "string" ? req.params.id.trim() : "";
    if (!spotId)
      return res.status(400).json({ message: "Spot id is required" });

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

/**
 * Return aggregate star rating plus the current user's rating for a spot.
 */
export async function getSpotRating(req: Request, res: Response) {
  try {
    const userId = getAuthUserId(req, res);
    if (!userId) return;

    const spotId =
      typeof req.params.id === "string" ? req.params.id.trim() : "";
    if (!spotId) {
      return res.status(400).json({ message: "Spot id is required" });
    }

    const found = await database
      .select({ id: spots.id })
      .from(spots)
      .where(eq(spots.id, spotId))
      .limit(1);

    if (found.length === 0) {
      return res.status(404).json({ message: "Spot not found" });
    }

    const summary = await loadSpotRatingSummary(spotId, userId);
    return res.status(200).json(summary);
  } catch (error) {
    return res.status(500).json({ message: "Server error" });
  }
}

/**
 * Create or update a user's star rating for a spot.
 */
export async function upsertSpotRating(req: Request, res: Response) {
  try {
    const userId = getAuthUserId(req, res);
    if (!userId) return;

    const spotId =
      typeof req.params.id === "string" ? req.params.id.trim() : "";
    if (!spotId) {
      return res.status(400).json({ message: "Spot id is required" });
    }

    const rating = parseStarRating(req.body?.rating);
    if (rating === null) {
      return res
        .status(400)
        .json({ message: "rating must be an integer between 1 and 5" });
    }

    const found = await database
      .select({ id: spots.id })
      .from(spots)
      .where(eq(spots.id, spotId))
      .limit(1);

    if (found.length === 0) {
      return res.status(404).json({ message: "Spot not found" });
    }

    await database
      .insert(spotRatings)
      .values({
        id: randomUUID(),
        spotId,
        userId,
        rating,
      })
      // Try to INSERT, if conflict run an UPDATE instead
      .onConflictDoUpdate({
        target: [spotRatings.spotId, spotRatings.userId],
        set: {
          rating,
          updatedAt: new Date(),
        },
      });

    const summary = await loadSpotRatingSummary(spotId, userId);
    return res.status(200).json(summary);
  } catch (error) {
    return res.status(500).json({ message: "Server error" });
  }
}

/**
 * Check hourly kiteable status for a spot for the next number of hours.
 */
export async function getSpotKiteableForecast(req: Request, res: Response) {
  try {
    const userId = getAuthUserId(req, res);
    if (!userId) return;

    const spotId =
      typeof req.params.id === "string" ? req.params.id.trim() : "";
      
    if (!spotId) {
      return res.status(400).json({ message: "Spot id is required" });
    }

    const directionMode = parseDirectionMode(req.query.directionMode);

    const rawHours =
      typeof req.query.hours === "string" ? req.query.hours.trim() : "";
    const parsedHours = rawHours ? Number.parseInt(rawHours, 10) : 42;

    // Keep API calls bounded in this version.
    const hours = Number.isFinite(parsedHours)
      ? Math.min(72, Math.max(1, parsedHours))
      : 42;

    const found = await database
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
      .where(eq(spots.id, spotId))
      .limit(1);

    const spot = found[0];

    if (!spot) {
      return res.status(404).json({ message: "Spot not found" });
    }

    if (spot.windDirStart === null || spot.windDirEnd === null) {
      return res.status(400).json({
        message: "Spot wind direction range is not configured",
      });
    }

    if (spot.isTidal === true) {
      const hasValidTidePreference =
        typeof spot.tidePreference === "string" &&
        spot.tidePreference.trim().length > 0;

      const hasValidTideWindow =
        typeof spot.tideWindowHours === "number" &&
        Number.isFinite(spot.tideWindowHours);

      if (!hasValidTidePreference || !hasValidTideWindow) {
        return res.status(400).json({
          message: "Spot tidal settings are incomplete",
        });
      }
    }

    let result;
    try {
      // Reuse the shared forecast builder so spot forecasts and session
      // forecasts rely on the same kiteability rules.
      result = await buildSpotHourlyForecast(spot, hours, directionMode);
    } catch (error) {
      console.error(error);
      const message =
        error instanceof Error ? error.message : "Failed to build forecast";

      if (message === "Tide API returned incomplete hourly data") {
        return res.status(502).json({ message: "Failed to fetch tide forecast" });
      }

      if (message === "Weather API returned incomplete hourly wind data") {
        return res.status(502).json({ message: "Failed to fetch weather forecast" });
      }

      if (message === "Spot tidal settings are incomplete") {
        return res.status(400).json({ message });
      }

      return res.status(502).json({
        message: message.toLowerCase().includes("tide")
          ? "Failed to fetch tide forecast"
          : "Failed to fetch weather forecast",
      });
    }

    return res.status(200).json({
      spotId: spot.id,
      spotName: spot.name,
      requestedHours: hours,
      kiteableHours: result.kiteableHours,
      forecast: result.forecast,
      thresholds: result.thresholds,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Server error" });
  }
}
