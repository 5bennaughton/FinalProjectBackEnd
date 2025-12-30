import express from "express"
const router = express.Router();
import { getLatestActivity, getAccessToken } from "../services/strava.service.js";
import { formatStravaSession } from "../models/session.model.js";


router.get("/strava/latest-activity", async (req, res) => {
  try {
    const accessToken = getAccessToken();
    const activity = await getLatestActivity(accessToken);

    if (!activity) {
      return res.status(404).json({ message: "No session found" });
    }

    const formatted = formatStravaSession(activity);
    res.json(formatted);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
