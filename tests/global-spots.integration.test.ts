import { eq } from "drizzle-orm";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { app } from "../src/app.js";
import { database } from "../src/db/db.js";
import { spotRatings, spots } from "../src/db/schema.js";
import { authHeaderFor, createSpotRecord, createUser } from "./helpers.js";

describe("Global spots routes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("rejects spot creation when only one wind direction boundary is provided", async () => {
    // Create an authenticated user because spot creation requires a valid owner.
    const user = await createUser({
      email: "spot-owner-wind@example.com",
    });

    // Send a payload with only one side of the direction range so the route
    // has to enforce the paired-field validation.
    const res = await request(app)
      .post("/global-spots/add-spot")
      .set(authHeaderFor(user.id, user.email))
      .send({
        name: "Incomplete Wind Spot",
        type: "kitesurfing",
        latitude: 53.3,
        longitude: -6.2,
        windDirStart: 270,
      });

    // The controller should reject the request instead of storing partial wind settings.
    expect(res.status).toBe(400);
    expect(res.body.message).toBe(
      "windDirStart and windDirEnd must both be provided"
    );
  });

  it("rejects tidal spot creation when tide settings are missing", async () => {
    // Create an authenticated owner because the request must pass auth
    // before the tidal validation branch is evaluated.
    const user = await createUser({
      email: "spot-owner-tide@example.com",
    });

    // Mark the spot as tidal but omit tidePreference and tideWindowHours
    // to verify both tidal requirements are enforced.
    const res = await request(app)
      .post("/global-spots/add-spot")
      .set(authHeaderFor(user.id, user.email))
      .send({
        name: "Needs Tide Config",
        type: "kitesurfing",
        latitude: 53.3,
        longitude: -6.2,
        windDirStart: 270,
        windDirEnd: 20,
        isTidal: true,
      });

    // The route should fail with the first missing tidal requirement.
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("tidePreference is required for tidal spots");
  });

  it("creates a valid tidal spot and persists the normalized wind and tide fields", async () => {
    // Create an authenticated owner for the new spot.
    const user = await createUser({
      email: "spot-owner-valid@example.com",
    });

    // Send a fully valid payload using string forms for some fields so the
    // test also covers the route's parsing and normalization behavior.
    const res = await request(app)
      .post("/global-spots/add-spot")
      .set(authHeaderFor(user.id, user.email))
      .send({
        name: "Tidal Test Spot",
        type: "kitesurfing",
        latitude: "53.301",
        longitude: "-6.201",
        description: " Works on a push tide ",
        windDirStart: "270",
        windDirEnd: "20",
        isTidal: "true",
        tidePreference: "high",
        tideWindowHours: "2",
      });

    // The route should succeed and return the stored payload.
    expect(res.status).toBe(201);
    expect(res.body.name).toBe("Tidal Test Spot");
    expect(res.body.isTidal).toBe(true);
    expect(res.body.tidePreference).toBe("high");
    expect(res.body.tideWindowHours).toBe(2);

    // Read the spot back from the database to make sure the persisted row
    // matches the normalized values returned by the API.
    const stored = await database
      .select()
      .from(spots)
      .where(eq(spots.id, res.body.id))
      .limit(1);

    // The database row should contain the parsed numbers and normalized tide fields.
    expect(stored[0]?.createdBy).toBe(user.id);
    expect(stored[0]?.windDirStart).toBe(270);
    expect(stored[0]?.windDirEnd).toBe(20);
    expect(stored[0]?.isTidal).toBe(true);
    expect(stored[0]?.tidePreference).toBe("high");
    expect(stored[0]?.tideWindowHours).toBe(2);
  });

  it("rejects ratings that are outside the allowed 1..5 integer range", async () => {
    // Create the owner and spot because the rating validation should run
    // against a real existing spot record.
    const user = await createUser({
      email: "rating-owner-invalid@example.com",
    });
    const spot = await createSpotRecord({
      createdBy: user.id,
    });

    // Submit an invalid rating to verify the route rejects bad client input.
    const res = await request(app)
      .post(`/global-spots/${spot.id}/rating`)
      .set(authHeaderFor(user.id, user.email))
      .send({ rating: 6 });

    // The controller should stop before inserting anything into SpotRating.
    expect(res.status).toBe(400);
    expect(res.body.message).toBe(
      "rating must be an integer between 1 and 5"
    );
  });

  it("updates the same user's rating instead of creating duplicate spot-rating rows", async () => {
    // Create a rater and a spot because this route uses an upsert keyed
    // by the combination of user and spot.
    const user = await createUser({
      email: "rating-owner-upsert@example.com",
    });
    const spot = await createSpotRecord({
      createdBy: user.id,
    });

    // Submit the first rating so the route inserts a new row.
    const firstRes = await request(app)
      .post(`/global-spots/${spot.id}/rating`)
      .set(authHeaderFor(user.id, user.email))
      .send({ rating: 4 });

    // Submit a second rating from the same user so the route has to update
    // the existing row instead of inserting a duplicate.
    const secondRes = await request(app)
      .post(`/global-spots/${spot.id}/rating`)
      .set(authHeaderFor(user.id, user.email))
      .send({ rating: 2 });

    // The response should reflect the updated rating after the second request.
    expect(firstRes.status).toBe(200);
    expect(secondRes.status).toBe(200);
    expect(secondRes.body.myRating).toBe(2);
    expect(secondRes.body.averageRating).toBe(2);
    expect(secondRes.body.ratingCount).toBe(1);

    // Query the table directly to confirm only one row exists for this user/spot pair.
    const rows = await database
      .select()
      .from(spotRatings)
      .where(eq(spotRatings.spotId, spot.id));

    // Upsert behavior should leave the table with a single updated row.
    expect(rows).toHaveLength(1);
    expect(rows[0]?.rating).toBe(2);
  });

  it("returns the aggregate rating summary and the caller's own rating", async () => {
    // Create two raters because the summary endpoint needs multiple ratings
    // to prove both the average and the per-user myRating fields.
    const owner = await createUser({
      email: "rating-owner-summary@example.com",
    });
    const secondRater = await createUser({
      email: "rating-second-summary@example.com",
    });
    const spot = await createSpotRecord({
      createdBy: owner.id,
    });

    // Store one rating from each user through the real HTTP endpoint.
    await request(app)
      .post(`/global-spots/${spot.id}/rating`)
      .set(authHeaderFor(owner.id, owner.email))
      .send({ rating: 4 });
    await request(app)
      .post(`/global-spots/${spot.id}/rating`)
      .set(authHeaderFor(secondRater.id, secondRater.email))
      .send({ rating: 5 });

    // Fetch the summary as the first user so myRating should point at their score.
    const res = await request(app)
      .get(`/global-spots/${spot.id}/rating`)
      .set(authHeaderFor(owner.id, owner.email));

    // The endpoint should calculate the rounded average and include
    // the current user's own rating alongside the aggregate data.
    expect(res.status).toBe(200);
    expect(res.body.averageRating).toBe(4.5);
    expect(res.body.ratingCount).toBe(2);
    expect(res.body.myRating).toBe(4);
  });

  it("returns 400 for a kiteable forecast request when the spot has no wind range configured", async () => {
    // Create a user and a spot without wind direction settings because
    // the forecast route requires a configured wind window to evaluate kiteability.
    const user = await createUser({
      email: "forecast-owner-missing@example.com",
    });
    const spot = await createSpotRecord({
      createdBy: user.id,
      windDirStart: null,
      windDirEnd: null,
    });

    // Request a forecast for the incomplete spot.
    const res = await request(app)
      .get(`/global-spots/${spot.id}/kiteable-forecast`)
      .set(authHeaderFor(user.id, user.email));

    // The controller should fail before calling the weather provider.
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Spot wind direction range is not configured");
  });

  it("calculates a non-tidal kiteable forecast and clamps requested hours to 72", async () => {
    // Create an owner and a spot with a clockwise wind window that accepts
    // north-westerly winds but rejects southerly ones.
    const user = await createUser({
      email: "forecast-owner-non-tidal@example.com",
    });
    const spot = await createSpotRecord({
      createdBy: user.id,
      windDirStart: 270,
      windDirEnd: 20,
      isTidal: false,
    });

    // Stub the global fetch call so the test stays deterministic and does
    // not depend on the live Open-Meteo service.
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        hourly: {
          time: [
            "2026-03-13T10:00:00Z",
            "2026-03-13T11:00:00Z",
            "2026-03-13T12:00:00Z",
          ],
          wind_speed_10m: [20, 10, 25],
          wind_direction_10m: [300, 300, 200],
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    // Ask for more than the allowed maximum so the route has to clamp the request.
    const res = await request(app)
      .get(`/global-spots/${spot.id}/kiteable-forecast?hours=100`)
      .set(authHeaderFor(user.id, user.email));

    // The route should succeed, clamp to 72 hours, and only mark the
    // first hour as kiteable based on the stubbed wind data.
    expect(res.status).toBe(200);
    expect(res.body.requestedHours).toBe(72);
    expect(res.body.kiteableHours).toBe(1);
    expect(res.body.forecast).toHaveLength(3);
    expect(res.body.forecast[0]).toMatchObject({
      directionOk: true,
      speedOk: true,
      tideOk: true,
      kiteable: true,
    });
    expect(res.body.forecast[1]).toMatchObject({
      speedOk: false,
      kiteable: false,
    });
    expect(res.body.forecast[2]).toMatchObject({
      directionOk: false,
      kiteable: false,
    });

    // Inspect the mocked URL to verify the route really clamped the outbound query.
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("forecast_hours=72");
  });

  it("applies tidal filtering on top of wind checks for tidal spots", async () => {
    // Create an owner and a fully configured tidal spot so the forecast route
    // executes both the wind and tide branches.
    const user = await createUser({
      email: "forecast-owner-tidal@example.com",
    });
    const spot = await createSpotRecord({
      createdBy: user.id,
      windDirStart: 270,
      windDirEnd: 20,
      isTidal: true,
      tidePreference: "high",
      tideWindowHours: 0,
    });

    // Return one weather payload followed by one marine payload because the
    // controller fetches wind first and tide data second for tidal spots.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          hourly: {
            time: [
              "2026-03-13T10:00:00Z",
              "2026-03-13T11:00:00Z",
              "2026-03-13T12:00:00Z",
            ],
            wind_speed_10m: [20, 20, 20],
            wind_direction_10m: [300, 300, 300],
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          hourly: {
            time: [
              "2026-03-13T10:00:00Z",
              "2026-03-13T11:00:00Z",
              "2026-03-13T12:00:00Z",
            ],
            sea_level_height_msl: [1, 2, 1],
          },
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    // Request a forecast for the tidal spot.
    const res = await request(app)
      .get(`/global-spots/${spot.id}/kiteable-forecast?hours=3`)
      .set(authHeaderFor(user.id, user.email));

    // Only the middle hour should be tide-compatible because the mocked
    // sea-level curve creates a high-tide event at that exact time.
    expect(res.status).toBe(200);
    expect(res.body.kiteableHours).toBe(1);
    expect(res.body.forecast.map((hour: { tideOk: boolean }) => hour.tideOk)).toEqual([
      false,
      true,
      false,
    ]);
    expect(res.body.thresholds.isTidal).toBe(true);
    expect(res.body.thresholds.tidePreference).toBe("high");
  });

  it("returns 502 when the weather provider call fails", async () => {
    // Create an owner and a spot with valid wind settings so the request
    // reaches the external weather-fetch branch.
    const user = await createUser({
      email: "forecast-owner-error@example.com",
    });
    const spot = await createSpotRecord({
      createdBy: user.id,
      windDirStart: 270,
      windDirEnd: 20,
      isTidal: false,
    });

    // Silence the expected controller logging so this test failure mode
    // does not clutter the test output with a known, intentional error.
    vi.spyOn(console, "error").mockImplementation(() => {});

    // Force fetch to fail so the test covers the controller's provider error handling.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("provider unavailable"))
    );

    // Request a forecast and let the controller handle the mocked failure.
    const res = await request(app)
      .get(`/global-spots/${spot.id}/kiteable-forecast`)
      .set(authHeaderFor(user.id, user.email));

    // The endpoint should translate the provider failure into a 502 for clients.
    expect(res.status).toBe(502);
    expect(res.body.message).toBe("Failed to fetch weather forecast");
  });
});
