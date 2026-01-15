import express from "express";
import { authMiddleware } from "../middleware/auth.middleware.js";
import { listFriendFeed } from "../controllers/feed.controller.js";

const router = express.Router();

router.use(authMiddleware);
router.get("/posts", listFriendFeed);

export default router;
