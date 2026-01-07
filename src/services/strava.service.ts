let accessToken: string | null = null;
let refreshToken: string | null = null;
let expiresAt: number | null = null;

export function saveToken(tokenData: { 
  access_token: string; 
  refresh_token: string; 
  expires_at: number; 
}) {
  accessToken = tokenData.access_token;
  refreshToken = tokenData.refresh_token;
  expiresAt = tokenData.expires_at;
}

export function getAccessToken(): string {
  if (!accessToken) {
    throw new Error("No Strava access token available");
  }
  return accessToken;
}

export async function getLatestActivity(accessToken: string) {
  const response = await fetch(
    "https://www.strava.com/api/v3/athlete/activities?per_page=1",
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  if (!response.ok) {
    throw new Error("Failed to fetch activities from Strava");
  }

  const activities = await response.json();

  if (!Array.isArray(activities) || activities.length === 0) {
    return null;
  }

  return activities[0];
}