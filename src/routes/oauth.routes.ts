import express from "express";
import { startStravaOAuth, stravaCallback } from "../controllers/oauth.controller.js";
import { authMiddleware } from "../middleware/auth.middleware.js";

const router = express.Router();


router.get("/strava", startStravaOAuth);
router.get("/strava/callback", stravaCallback);

export default router;
