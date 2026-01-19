import express from "express";
import { authMiddleware } from "../middleware/auth.middleware.js";
import { createSpot, displaySpots } from "../controllers/global-spots.controller.js";

const router = express.Router();

router.use(authMiddleware);
router.post("/add-spot", createSpot);
router.get("/display-spots", displaySpots);

export default router;
