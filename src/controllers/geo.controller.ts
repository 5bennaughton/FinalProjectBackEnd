import type { Request, Response } from "express";

type PhotonProperties = {
  name?: string;
  street?: string;
  housenumber?: string;
  city?: string;
  state?: string;
  country?: string;
};

type PhotonFeature = {
  properties?: PhotonProperties;
  geometry?: {
    coordinates?: [number, number];
  };
};

type LocationResult = {
  label: string;
  lat: number;
  lon: number;
};

const PHOTON_ENDPOINT = "https://photon.komoot.io/api/";
const MIN_QUERY_LENGTH = 2;
const DEFAULT_LIMIT = 6;
const USER_AGENT =
  process.env.PHOTON_USER_AGENT ??
  "Booster2.0/1.0 (contact@yourdomain.com)";

function getQueryString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseLimit(value: unknown): number {
  const parsed =
    typeof value === "string" ? Number.parseInt(value, 10) : DEFAULT_LIMIT;
  return Number.isNaN(parsed) || parsed < 1 ? DEFAULT_LIMIT : parsed;
}

// Build a compact, human-friendly label from Photon properties.
function buildLabel(properties?: PhotonProperties): string {
  if (!properties) return "";
  const name =
    properties.name ||
    [properties.street, properties.housenumber].filter(Boolean).join(" ");
  return [name, properties.city, properties.country]
    .filter(Boolean)
    .join(", ");
}

function mapFeature(feature: PhotonFeature): LocationResult | null {
  const coordinates = feature.geometry?.coordinates;
  if (!coordinates || coordinates.length < 2) return null;

  const [lon, lat] = coordinates;
  const label = buildLabel(feature.properties);
  if (!label) return null;

  return { label, lat, lon };
}

/**
 * Proxy location autocomplete requests to Photon so the client does not hit
 * rate limits or violate User-Agent requirements.
 */
export async function autocompleteLocations(req: Request, res: Response) {
  try {
    const query = getQueryString(req.query.q);
    if (!query || query.length < MIN_QUERY_LENGTH) {
      return res.status(200).json({ results: [] });
    }

    const limit = parseLimit(req.query.limit);
    const url = new URL(PHOTON_ENDPOINT);
    url.searchParams.set("q", query);
    url.searchParams.set("limit", String(limit));

    const photonRes = await fetch(url.toString(), {
      headers: { "User-Agent": USER_AGENT },
    });
    const payload = await photonRes.json().catch(() => null);

    if (!photonRes.ok) {
      console.error("Photon error:", payload);
      return res.status(502).json({ message: "Location search failed" });
    }

    const features = Array.isArray(payload?.features) ? payload.features : [];

    const results = features
      .map(mapFeature)
      .filter((item: any): item is LocationResult => item !== null);

    return res.status(200).json({ results });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Server error" });
  }
}
