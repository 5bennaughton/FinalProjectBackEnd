import type { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { and, eq, ilike, sql } from "drizzle-orm";
import { database } from "../db/db.js";
import { spotRatings, spots } from "../db/schema.js";
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

const OPEN_METEO_FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const minimumWindKnots = 15;
const maxWindKnots = 40;
type DirectionMode = "clockwise" | "anticlockwise";

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
 * Returns clockwise distance on a 0-359 circle.
 */
function clockwiseDistance(to: number, from: number) {
  return (to - from + 360) % 360;
}

/**
 * Pull hourly wind values for the next N hours for one coordinate pair.
 */
async function fetchHourlyWind(
  latitude: number,
  longitude: number,
  hours: number
) {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    hourly: "wind_speed_10m,wind_direction_10m",
    forecast_hours: String(hours),
    wind_speed_unit: "kn",
    timezone: "auto",
  });

  const response = await fetch(`${OPEN_METEO_FORECAST_URL}?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`Weather API error (${response.status})`);
  }

  const data = await response.json();

  const times = Array.isArray(data?.hourly?.time) ? data.hourly.time : null;

  const speeds = Array.isArray(data?.hourly?.wind_speed_10m)
    ? data.hourly.wind_speed_10m
    : null;

  const directions = Array.isArray(data?.hourly?.wind_direction_10m)
    ? data.hourly.wind_direction_10m
    : null;

  if (!times || !speeds || !directions) {
    throw new Error("Weather API returned incomplete hourly wind data");
  }

  return { times, speeds, directions };
}

/**
 * Checks whether a direction is inside the computed arc
 * Mode can be clockwise, or anticlockwise
 * @param mode - defaulted to clockwise
 */
function isDirectionInRange(
  windDirection: number,
  start: number,
  end: number,
  mode: DirectionMode = "clockwise"
) {
  const normalize = (angle: number) => ((angle % 360) + 360) % 360;

  const cleanedDirection = normalize(windDirection);
  const cleanedStart = normalize(start);
  const cleanedEnd = normalize(end);

  // Gets the allowed arc and compared for exmaple
  // Start = 270, End = 100 => ((270 - 100) + 360) % 360 = 190 
  // Now Start == 270 windDirection == 300 => ((300 - 270) + 360) % 360 = 30
  // 30 <= 190 return true
  if (mode === "clockwise") {
    const clockwiseSpan = clockwiseDistance(cleanedEnd, cleanedStart);
    const clockwiseFromStart = clockwiseDistance(cleanedDirection, cleanedStart);
    return clockwiseFromStart <= clockwiseSpan;
  }

  if (mode === "anticlockwise") {
    const antiClockwiseSpan = clockwiseDistance(cleanedStart, cleanedEnd);
    const antiClockwiseFromStart = clockwiseDistance(cleanedStart, cleanedDirection);
    return antiClockwiseFromStart <= antiClockwiseSpan;
  }

  return false;
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

/**
 * Return aggregate star rating plus the current user's rating for a spot.
 */
export async function getSpotRating(req: Request, res: Response) {
  try {
    const userId = getAuthUserId(req, res);
    if (!userId) return;

    const spotId = typeof req.params.id === "string" ? req.params.id.trim() : "";
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

    const spotId = typeof req.params.id === "string" ? req.params.id.trim() : "";
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

    const spotId = typeof req.params.id === "string" ? req.params.id.trim() : "";
    if (!spotId) {
      return res.status(400).json({ message: "Spot id is required" });
    }

    const directionMode = parseDirectionMode(req.query.directionMode);
    const rawHours = typeof req.query.hours === "string" ? req.query.hours.trim() : "";
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

    let hourly;
    try {
      hourly = await fetchHourlyWind(spot.latitude, spot.longitude, hours);
    } catch (error) {
      console.error(error);
      return res.status(502).json({ message: "Failed to fetch weather forecast" });
    }

    // Counting the length of array so we know for future if we loop it
    const count = Math.min(
      hourly.times.length,
      hourly.speeds.length,
      hourly.directions.length
    );

    const forecast: Array<{
      time: string;
      speedKn: number;
      directionDeg: number;
      directionOk: boolean;
      speedOk: boolean;
      tideOk: boolean;
      kiteable: boolean;
    }> = [];

    // Looping the hourly forcast and computes kiteablity for each hour
    for (let index = 0; index < count; index += 1) {
      const time = String(hourly.times[index]);
      const speedKnots = Number(hourly.speeds[index]);
      const directionDegrees = Number(hourly.directions[index]);

      if (!Number.isFinite(speedKnots) || !Number.isFinite(directionDegrees)) {
        continue;
      }

      const directionOk = isDirectionInRange(
        directionDegrees,
        spot.windDirStart,
        spot.windDirEnd,
        directionMode
      );
      const speedOk = speedKnots >= minimumWindKnots && speedKnots <= maxWindKnots;
      const tideOk = true;

      // Add an item to end of forcast array with the following values below
      forecast.push({
        time,
        speedKn: Number(speedKnots.toFixed(1)),
        directionDeg: Math.round(directionDegrees),
        directionOk,
        speedOk,
        tideOk,
        kiteable: directionOk && speedOk && tideOk,
      });
    }

    // Counts how many hours in the next 42 hours are kitable
    const kiteableHours = forecast.filter((hour) => hour.kiteable).length;

    return res.status(200).json({
      spotId: spot.id,
      spotName: spot.name,
      requestedHours: hours,
      kiteableHours,
      forecast,
      thresholds: {
        minWindKn: minimumWindKnots,
        maxWindKn: maxWindKnots,
        windDirStart: spot.windDirStart,
        windDirEnd: spot.windDirEnd,
        directionMode,
      },
      note: spot.isTidal ? "Tide is not checked in this version." : null,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Server error" });
  }
}
