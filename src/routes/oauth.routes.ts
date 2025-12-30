import express from "express";
const router = express.Router();

// hardcoded for now
const STRAVA_CLIENT_ID = "182126";
const STRAVA_CLIENT_SECRET = "de2a59a3d9026bbba09dec5043c515d93618dc54";
const STRAVA_REDIRECT_URI = "http://192.168.68.61:5001/auth/strava/callback";

let accessToken: string | null;

import { token } from '../services/strava.service.js'

const STRAVA_AUTH_URL =
  `https://www.strava.com/oauth/authorize` +
  `?client_id=${encodeURIComponent(STRAVA_CLIENT_ID)}` +
  `&response_type=code` +
  `&redirect_uri=${encodeURIComponent(STRAVA_REDIRECT_URI)}` +
  `&approval_prompt=force` +
  `&scope=${encodeURIComponent("activity:read_all")}`;

// 1) Start OAuth: redirect to Strava
//TODO deal with req and res
router.get("/strava", (req: import("express").Request, res: import("express").Response) => {
  return res.redirect(STRAVA_AUTH_URL);
});

// 2) Strava redirects here after user authorizes
//TODO deal with req and res
router.get("/strava/callback", async (req: import("express").Request, res: import("express").Response) => {
  const code = req.query.code;

  if (!code) return res.status(400).send("Missing code");

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

  const tokenData = await tokenRes.json();
  token(tokenData);

  // TODO: store these per-user in a DB (recommended).
  // For quick testing, keep in memory:
  accessToken = tokenData.access_token;
  res.send("✅ Connected. You can close this tab.");
});

export default router;



