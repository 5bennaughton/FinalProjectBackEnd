import express from "express";
import { authMiddleware } from "../middleware/auth.middleware.js";
import { getUserProfile } from "../controllers/users.controller.js";

const router = express.Router();

router.use(authMiddleware);
router.get("/:userId", getUserProfile);

export default router;
