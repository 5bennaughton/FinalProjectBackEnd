import { describe, expect, it, vi } from "vitest";
import {
  getAuthUserId,
  getRequiredString,
  parseNumber,
} from "../src/helpers/helperFunctions.js";

describe("helperFunctions", () => {
  it("trims surrounding whitespace from required strings", () => {
    expect(getRequiredString("  Dollymount  ")).toBe("Dollymount");
  });

  it("returns null for blank required strings", () => {
    expect(getRequiredString("   ")).toBeNull();
  });

  it("parses numeric strings into numbers", () => {
    expect(parseNumber("12.5")).toBe(12.5);
  });

  it("returns null for empty or invalid numeric input", () => {
    expect(parseNumber("")).toBeNull();
    expect(parseNumber("not-a-number")).toBeNull();
  });

  it("returns null and sends 401 when no authenticated user is present", () => {
    const req = {} as Parameters<typeof getAuthUserId>[0];

    // The helper only uses status().json(), so a tiny mock response is enough.
    const status = vi.fn().mockReturnThis();
    const json = vi.fn();
    const res = { status, json } as unknown as Parameters<
      typeof getAuthUserId
    >[1];

    expect(getAuthUserId(req, res)).toBeNull();
    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith({ message: "Unauthorized" });
  });
});
