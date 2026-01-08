import express from "express";
import { authMiddleware } from "../middleware/auth.middleware.js";
import { postFutureSession, listPosts } from "../controllers/future-sessions.controller.js";

const router = express.Router();

router.use(authMiddleware);
router.post("/post-session", postFutureSession);
router.get("/list-posts", listPosts);


export default router;
