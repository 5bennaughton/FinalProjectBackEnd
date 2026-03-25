import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildSpotHourlyForecast,
  isDirectionInRange,
  parseStoredTidePreference,
  type SpotForecastConfig,
} from "../src/services/kiteability.service.js";

describe("kiteability service", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("normalizes both current and legacy tide preference values", () => {
    expect(parseStoredTidePreference("high")).toBe("high");
    expect(parseStoredTidePreference("before_high")).toBe("high");
    expect(parseStoredTidePreference("after_low")).toBe("low");
  });

  it("returns null for unsupported tide preference values", () => {
    expect(parseStoredTidePreference("mid")).toBeNull();
    expect(parseStoredTidePreference(null)).toBeNull();
  });

  it("checks wind direction ranges for both clockwise and anticlockwise arcs", () => {
    expect(isDirectionInRange(20, 300, 40, "clockwise")).toBe(true);
    expect(isDirectionInRange(200, 300, 40, "clockwise")).toBe(false);
    expect(isDirectionInRange(200, 300, 40, "anticlockwise")).toBe(true);
  });

  it("marks only the matching wind hours as kiteable", async () => {
    const spot: SpotForecastConfig = {
      id: "spot-1",
      name: "Dollymount",
      latitude: 53.36,
      longitude: -6.15,
      windDirStart: 60,
      windDirEnd: 120,
      isTidal: false,
      tidePreference: null,
      tideWindowHours: null,
    };

    // Keep the mock small: this service test only needs one weather response.
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        hourly: {
          time: ["2026-03-22T10:00:00Z", "2026-03-22T11:00:00Z"],
          wind_speed_10m: [20, 10],
          wind_direction_10m: [90, 250],
        },
      }),
    } as Response);

    const result = await buildSpotHourlyForecast(spot, 2);

    expect(result.kiteableHours).toBe(1);
    expect(result.forecast).toHaveLength(2);
    expect(result.forecast[0]).toMatchObject({
      directionOk: true,
      speedOk: true,
      tideOk: true,
      kiteable: true,
    });
    expect(result.forecast[1]).toMatchObject({
      directionOk: false,
      speedOk: false,
      tideOk: true,
      kiteable: false,
    });
  });

  it("rejects tidal spots when the tide settings are incomplete", async () => {
    const spot: SpotForecastConfig = {
      id: "spot-2",
      name: "Brandon Bay",
      latitude: 52.27,
      longitude: -10.16,
      windDirStart: 80,
      windDirEnd: 140,
      isTidal: true,
      tidePreference: null,
      tideWindowHours: null,
    };

    // The service fetches wind first, so the test provides a minimal valid
    // weather payload and then checks that the missing tide config is rejected.
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        hourly: {
          time: ["2026-03-22T10:00:00Z"],
          wind_speed_10m: [20],
          wind_direction_10m: [100],
        },
      }),
    } as Response);

    await expect(buildSpotHourlyForecast(spot, 1)).rejects.toThrow(
      "Spot tidal settings are incomplete"
    );
  });
});
