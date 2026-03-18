const OPEN_METEO_FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const OPEN_METEO_MARINE_URL = "https://marine-api.open-meteo.com/v1/marine";
const minimumWindKnots = 15;
const maxWindKnots = 40;
const openMeteoMaxRetries = 2;

export type DirectionMode = "clockwise" | "anticlockwise";

type TideEvent = {
  time: Date;
  kind: "high" | "low";
};

export type SpotForecastConfig = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  windDirStart: number | null;
  windDirEnd: number | null;
  isTidal: boolean | null;
  tidePreference: string | null;
  tideWindowHours: number | null;
};

export type KiteableForecastHour = {
  time: string;
  speedKn: number;
  directionDeg: number;
  directionOk: boolean;
  speedOk: boolean;
  tideOk: boolean;
  kiteable: boolean;
};

export type SpotForecastBuildResult = {
  forecast: KiteableForecastHour[];
  kiteableHours: number;
  thresholds: {
    minWindKn: number;
    maxWindKn: number;
    windDirStart: number;
    windDirEnd: number;
    directionMode: DirectionMode | undefined;
    isTidal: boolean;
    tidePreference: "high" | "low" | null;
    tideWindowHours: number | null;
    tideProvider: string | null;
  };
};

/**
 * Normalize older stored tide values into the current "high"/"low" model.
 */
export function parseStoredTidePreference(
  value: unknown
): "high" | "low" | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim().toLowerCase();

  if (cleaned === "high" || cleaned === "low") {
    return cleaned;
  }

  if (
    cleaned === "before_high" ||
    cleaned === "after_high" ||
    cleaned === "before_low" ||
    cleaned === "after_low"
  ) {
    return cleaned.endsWith("_high") ? "high" : "low";
  }

  return null;
}

/**
 * Fetch JSON from Open-Meteo and retry a small number of times before failing.
 */
async function fetchOpenMeteoJson(url: string) {
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= openMeteoMaxRetries; attempt += 1) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Weather API error (${response.status})`);
      }
      return await response.json();
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}

/**
 * Returns clockwise distance on a 0-359 circle.
 */
function clockwiseDistance(to: number, from: number) {
  return (to - from + 360) % 360;
}

/**
 * Fetch the hourly wind forecast for one coordinate pair.
 */
async function fetchHourlyWind(latitude: number, longitude: number, hours: number) {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    hourly: "wind_speed_10m,wind_direction_10m",
    forecast_hours: String(hours),
    wind_speed_unit: "kn",
    timezone: "auto",
  });

  const data = await fetchOpenMeteoJson(
    `${OPEN_METEO_FORECAST_URL}?${params.toString()}`
  );

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
 * Fetch hourly mean sea-level values for the same coordinate pair.
 */
async function fetchHourlyTideHeights(
  latitude: number,
  longitude: number,
  hours: number
) {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    hourly: "sea_level_height_msl",
    forecast_hours: String(hours),
    timezone: "auto",
  });

  const data = await fetchOpenMeteoJson(
    `${OPEN_METEO_MARINE_URL}?${params.toString()}`
  );

  const times = Array.isArray(data?.hourly?.time) ? data.hourly.time : null;
  const levels = Array.isArray(data?.hourly?.sea_level_height_msl)
    ? data.hourly.sea_level_height_msl
    : null;

  if (!times || !levels) {
    throw new Error("Tide API returned incomplete hourly data");
  }

  return { times, levels };
}

/**
 * Infer high- and low-tide events from a series of hourly sea-level values.
 */
function extractTideEvents(times: unknown[], levels: unknown[]) {
  const events: TideEvent[] = [];
  const count = Math.min(times.length, levels.length);

  if (count < 2) return events;

  const firstLevel = Number(levels[0]);
  const secondLevel = Number(levels[1]);
  const firstTime = new Date(String(times[0]));
  if (
    Number.isFinite(firstLevel) &&
    Number.isFinite(secondLevel) &&
    !Number.isNaN(firstTime.getTime())
  ) {
    if (firstLevel < secondLevel) {
      events.push({ time: firstTime, kind: "low" });
    } else if (firstLevel > secondLevel) {
      events.push({ time: firstTime, kind: "high" });
    }
  }

  for (let index = 1; index < count - 1; index += 1) {
    const prev = Number(levels[index - 1]);
    const current = Number(levels[index]);
    const next = Number(levels[index + 1]);

    if (
      !Number.isFinite(prev) ||
      !Number.isFinite(current) ||
      !Number.isFinite(next)
    ) {
      continue;
    }

    const eventTime = new Date(String(times[index]));
    if (Number.isNaN(eventTime.getTime())) {
      continue;
    }

    if (current >= prev && current >= next) {
      events.push({ time: eventTime, kind: "high" });
      continue;
    }

    if (current <= prev && current <= next) {
      events.push({ time: eventTime, kind: "low" });
    }
  }

  const penultimateLevel = Number(levels[count - 2]);
  const lastLevel = Number(levels[count - 1]);
  const lastTime = new Date(String(times[count - 1]));
  if (
    Number.isFinite(lastLevel) &&
    Number.isFinite(penultimateLevel) &&
    !Number.isNaN(lastTime.getTime())
  ) {
    if (lastLevel < penultimateLevel) {
      events.push({ time: lastTime, kind: "low" });
    } else if (lastLevel > penultimateLevel) {
      events.push({ time: lastTime, kind: "high" });
    }
  }

  return events;
}

/**
 * Returns true when the hour falls inside the configured tide window.
 */
function isHourInsideTideWindow(
  hourTime: Date,
  events: TideEvent[],
  preference: "high" | "low",
  windowHours: number
) {
  return events.some((event) => {
    if (event.kind !== preference) return false;

    const hoursDiff =
      (hourTime.getTime() - event.time.getTime()) / (1000 * 60 * 60);
    return Math.abs(hoursDiff) <= windowHours;
  });
}

/**
 * Check whether a wind direction sits inside the configured allowed arc.
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

  if (mode === "clockwise") {
    const clockwiseSpan = clockwiseDistance(cleanedEnd, cleanedStart);
    const clockwiseFromStart = clockwiseDistance(
      cleanedDirection,
      cleanedStart
    );
    return clockwiseFromStart <= clockwiseSpan;
  }

  const antiClockwiseSpan = clockwiseDistance(cleanedStart, cleanedEnd);
  const antiClockwiseFromStart = clockwiseDistance(
    cleanedStart,
    cleanedDirection
  );
  return antiClockwiseFromStart <= antiClockwiseSpan;
}

/**
 * Build the per-hour kiteability forecast for one configured spot.
 * The caller is expected to check that required spot configuration exists.
 */
export async function buildSpotHourlyForecast(
  spot: SpotForecastConfig,
  hours: number,
  directionMode?: DirectionMode
): Promise<SpotForecastBuildResult> {
  const hourly = await fetchHourlyWind(spot.latitude, spot.longitude, hours);

  const spotIsTidal = spot.isTidal === true;
  const tidePreference = parseStoredTidePreference(spot.tidePreference);

  const tideWindowHours =
    typeof spot.tideWindowHours === "number" &&
    Number.isFinite(spot.tideWindowHours)
      ? spot.tideWindowHours
      : null;

  const tideProvider = spotIsTidal ? "open-meteo" : null;
  let tideEvents: TideEvent[] = [];

  if (spotIsTidal) {
    if (!spot.tidePreference || tideWindowHours === null) {
      throw new Error("Spot tidal settings are incomplete");
    }

    const tideHourly = await fetchHourlyTideHeights(
      spot.latitude,
      spot.longitude,
      hours
    );
    tideEvents = extractTideEvents(tideHourly.times, tideHourly.levels);
  }

  const count = Math.min(
    hourly.times.length,
    hourly.speeds.length,
    hourly.directions.length
  );

  const forecast: KiteableForecastHour[] = [];

  for (let index = 0; index < count; index += 1) {
    const time = String(hourly.times[index]);
    const speedKnots = Number(hourly.speeds[index]);
    const directionDegrees = Number(hourly.directions[index]);

    if (!Number.isFinite(speedKnots) || !Number.isFinite(directionDegrees)) {
      continue;
    }

    const directionOk = isDirectionInRange(
      directionDegrees,
      spot.windDirStart as number,
      spot.windDirEnd as number,
      directionMode
    );

    const speedOk = speedKnots >= minimumWindKnots && speedKnots <= maxWindKnots;
    let tideOk = true;

    if (spotIsTidal) {
      const hourTime = new Date(time);
      if (
        !Number.isNaN(hourTime.getTime()) &&
        tidePreference &&
        tideWindowHours !== null
      ) {
        tideOk = isHourInsideTideWindow(
          hourTime,
          tideEvents,
          tidePreference,
          tideWindowHours
        );
      } else {
        tideOk = false;
      }
    }

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

  return {
    forecast,
    kiteableHours: forecast.filter((hour) => hour.kiteable).length,
    thresholds: {
      minWindKn: minimumWindKnots,
      maxWindKn: maxWindKnots,
      windDirStart: spot.windDirStart as number,
      windDirEnd: spot.windDirEnd as number,
      directionMode,
      isTidal: spotIsTidal,
      tidePreference,
      tideWindowHours,
      tideProvider,
    },
  };
}
