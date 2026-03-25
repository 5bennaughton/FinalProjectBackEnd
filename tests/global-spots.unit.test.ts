import { describe, expect, it } from "vitest";
import {
  parseDirectionMode,
  parseSpotState,
  parseStarRating,
} from "../src/controllers/global-spots.controller.js";

describe("global spot helpers", () => {
  it("reads supported direction modes and ignores unknown values", () => {
    expect(parseDirectionMode("clockwise")).toBe("clockwise");
    expect(parseDirectionMode("  anticlockwise  ")).toBe("anticlockwise");
    expect(parseDirectionMode("sideways")).toBeUndefined();
  });

  it("accepts valid whole-star ratings and rejects invalid ones", () => {
    expect(parseStarRating(5)).toBe(5);
    expect(parseStarRating("3")).toBe(3);
    expect(parseStarRating(2.5)).toBeNull();
    expect(parseStarRating(0)).toBeNull();
    expect(parseStarRating(6)).toBeNull();
  });

  it("builds a valid non-tidal spot payload and clears tide fields", () => {
    const parsed = parseSpotState({
      name: "  Sandymount  ",
      type: "kitesurfing",
      latitude: "53.33",
      longitude: "-6.20",
      description: "  Flat water  ",
      isTidal: "false",
      tidePreference: "high",
      tideWindowHours: 2,
    });

    expect(parsed.message).toBeUndefined();
    expect(parsed.payload).toEqual({
      name: "Sandymount",
      type: "kitesurfing",
      latitude: 53.33,
      longitude: -6.2,
      description: "Flat water",
      windDirStart: null,
      windDirEnd: null,
      isTidal: false,
      tidePreference: null,
      tideWindowHours: null,
    });
  });

  it("rejects wind direction ranges when only one side is provided", () => {
    const parsed = parseSpotState({
      name: "Dollymount",
      type: "kitesurfing",
      latitude: 53.36,
      longitude: -6.15,
      windDirStart: 90,
    });

    expect(parsed.payload).toBeUndefined();
    expect(parsed.message).toBe(
      "windDirStart and windDirEnd must both be provided"
    );
  });

  it("requires the tide settings when a spot is marked as tidal", () => {
    const parsed = parseSpotState({
      name: "Brandon Bay",
      type: "kitesurfing",
      latitude: 52.27,
      longitude: -10.16,
      isTidal: true,
    });

    expect(parsed.payload).toBeUndefined();
    expect(parsed.message).toBe("tidePreference is required for tidal spots");
  });
});
