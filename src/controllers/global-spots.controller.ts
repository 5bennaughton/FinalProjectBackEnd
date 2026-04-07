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
  parseStoredDirectionMode,
  type DirectionMode,
} from "../services/kiteability.service.js";

export type SpotPayload = {
  name: string;
  type: string;
  latitude: number;
  longitude: number;
  description: string | null;
  windDirStart: number | null;
  windDirEnd: number | null;
  directionMode: DirectionMode | null;
  isTidal: boolean | null;
  tidePreference: string | null;
  tideWindowHours: number | null;
};

export type SpotRecord = SpotPayload & {
  id: string;
  createdBy: string;
};

type SpotRatingSummary = {
  spotId: string;
  averageRating: number | null;
  ratingCount: number;
  myRating: number | null;
};

/**
 * Reads direction mode from input and keeps the accepted values narrow.
 */
export function parseDirectionMode(raw: unknown): DirectionMode | undefined {
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
export function parseStarRating(value: unknown) {
  const parsed = parseNumber(value);
  if (parsed === null) return null;
  if (!Number.isInteger(parsed)) return null;
  if (parsed < 1 || parsed > 5) return null;
  return parsed;
}

function getSpotId(req: Request, res: Response) {
  const spotId =
    typeof req.params.id === "string" ? req.params.id.trim() : "";

  if (!spotId) {
    res.status(400).json({ message: "Spot id is required" });
    return null;
  }
  return spotId;
}

function parseBooleanInput(value: unknown): boolean | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value === "boolean") return value;

  if (typeof value === "string") {
    const raw = value.trim().toLowerCase();
    if (raw === "true") return true;
    if (raw === "false") return false;
  }
  return undefined;
}

export function parseSpotState(
  body: Record<string, unknown> | undefined,
  existing?: SpotRecord
): { payload?: SpotPayload; changed?: boolean; message?: string } {
  const source = body ?? {};
  let changed = false;

  const nameProvided = Object.prototype.hasOwnProperty.call(source, "name");
  const name = nameProvided
    ? getRequiredString(source.name)
    : existing?.name ?? null;

  if (nameProvided) {
    changed = true;
    if (!name) return { message: "Name is required" };
  }
  if (!existing && !name) return { message: "Name is required" };

  const typeProvided = Object.prototype.hasOwnProperty.call(source, "type");

  const type = typeProvided
    ? getRequiredString(source.type)
    : existing?.type ?? null;

  if (typeProvided) {
    changed = true;
    if (!type) return { message: "Type is required" };
  }
  if (!existing && !type) return { message: "Type is required" };

  const latitudeProvided =
    Object.prototype.hasOwnProperty.call(source, "latitude") ||
    Object.prototype.hasOwnProperty.call(source, "lat");

  const latitudeRaw = source.latitude ?? source.lat;

  const latitude = latitudeProvided
    ? parseNumber(latitudeRaw)
    : existing?.latitude ?? null;

  if (latitudeProvided) {
    changed = true;
    if (latitude === null) return { message: "Latitude is required" };
  }
  if (!existing && latitude === null) {
    return { message: "Latitude is required" };
  }

  const longitudeProvided =
    Object.prototype.hasOwnProperty.call(source, "longitude") ||
    Object.prototype.hasOwnProperty.call(source, "lon");

  const longitudeRaw = source.longitude ?? source.lon;

  const longitude = longitudeProvided
    ? parseNumber(longitudeRaw)
    : existing?.longitude ?? null;

  if (longitudeProvided) {
    changed = true;
    if (longitude === null) return { message: "Longitude is required" };
  }

  if (!existing && longitude === null) {
    return { message: "Longitude is required" };
  }

  let description = existing?.description ?? null;
  if (Object.prototype.hasOwnProperty.call(source, "description")) {
    changed = true;

    if (
      source.description !== null &&
      source.description !== undefined &&
      typeof source.description !== "string"
    ) {
      return { message: "Description must be a string" };
    }

    description =
      typeof source.description === "string"
        ? source.description.trim() || null
        : null;
  }

  let windDirStart = existing?.windDirStart ?? null;
  if (Object.prototype.hasOwnProperty.call(source, "windDirStart")) {
    changed = true;

    const raw = source.windDirStart;
    const parsed = parseNumber(raw);

    if (raw !== undefined && raw !== null && raw !== "" && parsed === null) {
      return { message: "windDirStart must be a number" };
    }
    windDirStart = parsed;
  }

  let windDirEnd = existing?.windDirEnd ?? null;
  if (Object.prototype.hasOwnProperty.call(source, "windDirEnd")) {
    changed = true;

    const raw = source.windDirEnd;
    const parsed = parseNumber(raw);

    if (raw !== undefined && raw !== null && raw !== "" && parsed === null) {
      return { message: "windDirEnd must be a number" };
    }
    windDirEnd = parsed;
  }

  let directionMode = existing?.directionMode ?? null;
  if (Object.prototype.hasOwnProperty.call(source, "directionMode")) {
    changed = true;

    if (
      source.directionMode === null ||
      source.directionMode === undefined ||
      source.directionMode === ""
    ) {
      directionMode = null;
    } else {
      const parsed = parseDirectionMode(source.directionMode);

      if (!parsed) {
        return { message: "directionMode must be clockwise or anticlockwise" };
      }

      directionMode = parsed;
    }
  }

  let isTidal = existing?.isTidal ?? null;
  if (Object.prototype.hasOwnProperty.call(source, "isTidal")) {
    changed = true;

    const parsed = parseBooleanInput(source.isTidal);
    if (parsed === undefined) {
      return { message: "isTidal must be true or false" };
    }
    isTidal = parsed;
  }

  let tidePreference = existing?.tidePreference ?? null;

  if (Object.prototype.hasOwnProperty.call(source, "tidePreference")) {
    changed = true;
    
    if (
      source.tidePreference !== null &&
      source.tidePreference !== undefined &&
      typeof source.tidePreference !== "string"
    ) {
      return { message: "tidePreference must be high, low" };
    }

    const raw =
      typeof source.tidePreference === "string"
        ? source.tidePreference.trim().toLowerCase()
        : "";

    if (!raw) {
      tidePreference = null;
    } else if (raw === "high" || raw === "low") {
      tidePreference = raw;
    } else {
      return { message: "tidePreference must be high, low" };
    }
  }

  let tideWindowHours = existing?.tideWindowHours ?? null;
  if (Object.prototype.hasOwnProperty.call(source, "tideWindowHours")) {
    changed = true;

    const raw = source.tideWindowHours;
    const parsed = parseNumber(raw);

    if (raw !== undefined && raw !== null && raw !== "" && parsed === null) {
      return { message: "tideWindowHours must be a number" };
    }
    tideWindowHours = parsed;
  }

  if (
    (windDirStart !== null && windDirEnd === null) ||
    (windDirStart === null && windDirEnd !== null)
  ) {
    return {
      message: "windDirStart and windDirEnd must both be provided",
    };
  }

  if (windDirStart !== null && (windDirStart < 0 || windDirStart > 359)) {
    return { message: "windDirStart must be between 0 and 359" };
  }

  if (windDirEnd !== null && (windDirEnd < 0 || windDirEnd > 359)) {
    return { message: "windDirEnd must be between 0 and 359" };
  }

  if (tideWindowHours !== null && tideWindowHours < 0) {
    return { message: "tideWindowHours must be 0 or greater" };
  }

  if (isTidal) {
    if (!tidePreference) {
      return { message: "tidePreference is required for tidal spots" };
    }
    
    if (tideWindowHours === null) {
      return { message: "tideWindowHours is required for tidal spots" };
    }
  } else {
    tidePreference = null;
    tideWindowHours = null;
  }

  return {
    changed,
    payload: {
      name: name!,
      type: type!,
      latitude: latitude!,
      longitude: longitude!,
      description,
      windDirStart,
      windDirEnd,
      directionMode,
      isTidal,
      tidePreference,
      tideWindowHours,
    },
  };
}

async function loadSpotById(spotId: string): Promise<SpotRecord | null> {
  const found = await database
    .select({
      id: spots.id,
      name: spots.name,
      type: spots.type,
      latitude: spots.latitude,
      longitude: spots.longitude,
      description: spots.description,
      windDirStart: spots.windDirStart,
      windDirEnd: spots.windDirEnd,
      directionMode: spots.directionMode,
      isTidal: spots.isTidal,
      tidePreference: spots.tidePreference,
      tideWindowHours: spots.tideWindowHours,
      createdBy: spots.createdBy,
    })
    .from(spots)
    .where(eq(spots.id, spotId))
    .limit(1);

  const spot = found[0];
  if (!spot) return null;

  return {
    ...spot,
    directionMode: parseStoredDirectionMode(spot.directionMode),
  };
}

function canManageSpot(req: Request, spot: SpotRecord) {
  const userId = req.user?.id;
  const role = req.user?.role ?? "user";
  return userId === spot.createdBy || role === "admin";
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
    const parsed = parseSpotState(req.body);
    if (!parsed.payload) {
      return res
        .status(400)
        .json({ message: parsed.message ?? "Invalid spot payload" });
    }

    const id = randomUUID();
    const payload = parsed.payload;

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
 * Update an existing spot. Owners and admins may edit.
 */
export async function updateSpot(req: Request, res: Response) {
  try {
    const userId = getAuthUserId(req, res);
    if (!userId) return;

    const spotId = getSpotId(req, res);
    if (!spotId) return;

    const spot = await loadSpotById(spotId);
    if (!spot) {
      return res.status(404).json({ message: "Spot not found" });
    }

    if (!canManageSpot(req, spot)) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const parsed = parseSpotState(req.body, spot);
    if (!parsed.payload) {
      return res
        .status(400)
        .json({ message: parsed.message ?? "Invalid spot payload" });
    }
    if (!parsed.changed) {
      return res.status(400).json({ message: "No spot fields provided" });
    }

    const payload = parsed.payload;

    await database
      .update(spots)
      .set({
        ...payload,
        updatedAt: new Date(),
      })
      .where(eq(spots.id, spotId));

    return res.status(200).json({
      id: spotId,
      ...payload,
      createdBy: spot.createdBy,
    });
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
        directionMode: spots.directionMode,
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

    const spotId = getSpotId(req, res);
    if (!spotId) return;

    const spot = await loadSpotById(spotId);
    if (!spot) {
      return res.status(404).json({ message: "Spot not found" });
    }

    if (!canManageSpot(req, spot)) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const deleted = await database
      .delete(spots)
      .where(eq(spots.id, spotId))
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

    const spotId = getSpotId(req, res);
    if (!spotId) return;

    const spot = await loadSpotById(spotId);
    if (!spot) {
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

    const spotId = getSpotId(req, res);
    if (!spotId) return;

    const rating = parseStarRating(req.body?.rating);
    if (rating === null) {
      return res
        .status(400)
        .json({ message: "rating must be an integer between 1 and 5" });
    }

    const spot = await loadSpotById(spotId);
    if (!spot) {
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

    const spotId = getSpotId(req, res);
    if (!spotId) return;

    const rawHours =
      typeof req.query.hours === "string" ? req.query.hours.trim() : "";
    const parsedHours = rawHours ? Number.parseInt(rawHours, 10) : 42;

    // Keep API calls bounded in this version.
    const hours = Number.isFinite(parsedHours)
      ? Math.min(72, Math.max(1, parsedHours))
      : 42;

    const spot = await loadSpotById(spotId);
    if (!spot) {
      return res.status(404).json({ message: "Spot not found" });
    }

    const requestedDirectionMode = parseDirectionMode(req.query.directionMode);

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
    const directionMode = spot.directionMode ?? requestedDirectionMode;

    let result;
    try {
      // Reuse the shared forecast builder so spot forecasts and session
      // forecasts rely on the same kiteability rules. Stored spot config wins,
      // while the query param remains a fallback for older spots.
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
