import express from "express";
import { authMiddleware } from "../middleware/auth.middleware.js";
import { autocompleteLocations } from "../controllers/geo.controller.js";

const router = express.Router();

router.use(authMiddleware);
router.get("/autocomplete", autocompleteLocations);

export default router;
