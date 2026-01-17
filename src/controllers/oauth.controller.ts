import type { Request, Response } from "express";
import { saveToken } from "../services/strava.service.js";

const STRAVA_CLIENT_ID = "182126";
const STRAVA_CLIENT_SECRET = "de2a59a3d9026bbba09dec5043c515d93618dc54";
const STRAVA_REDIRECT_URI = "http://192.168.68.61:5001/oauth/strava/callback";

const STRAVA_AUTH_URL =
  `https://www.strava.com/oauth/authorize` +
  `?client_id=${encodeURIComponent(STRAVA_CLIENT_ID)}` +
  `&response_type=code` +
  `&redirect_uri=${encodeURIComponent(STRAVA_REDIRECT_URI)}` +
  `&approval_prompt=force` +
  `&scope=${encodeURIComponent("activity:read_all")}`;

/**
 * Redirect the user to Strava's OAuth consent screen.
 */
export const startStravaOAuth = (req: Request, res: Response) => {
  return res.redirect(STRAVA_AUTH_URL);
};

/**
 * Exchange the OAuth code for a token and persist it.
 * Returns a simple confirmation message to the browser.
 */
export const stravaCallback = async (req: Request, res: Response) => {
  const code = req.query.code;
  
  if (!code) {
    return res.status(400).send("Missing code");
  }

  try {
    const tokenRes = await fetch("https://www.strava.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: STRAVA_CLIENT_ID,
        client_secret: STRAVA_CLIENT_SECRET,
        code: String(code),
        grant_type: "authorization_code",
      }),
    });

    if (!tokenRes.ok) {
      return res.status(500).send("Failed to get token from Strava");
    }

    const tokenData = await tokenRes.json();
    saveToken(tokenData);
    
    res.send("✅ Connected. You can close this tab.");
  } catch (error) {
    res.status(500).send("Error connecting to Strava");
  }
};
