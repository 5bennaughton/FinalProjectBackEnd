import express from "express";
import { authMiddleware } from "../middleware/auth.middleware.js";
import {
  createSpot,
  deleteSpot,
  displaySpots,
  searchSpots,
} from "../controllers/global-spots.controller.js";

const router = express.Router();

router.use(authMiddleware);
router.post("/add-spot", createSpot);
router.get("/display-spots", displaySpots);
router.get("/search", searchSpots);
router.delete("/delete-spot/:id", deleteSpot);

export default router;
