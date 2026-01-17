import express from "express";
import { authMiddleware } from "../middleware/auth.middleware.js";
import { postFutureSession, listPosts, deleteFutureSession, addComment, displayComments } from "../controllers/future-sessions.controller.js";

const router = express.Router();

router.use(authMiddleware);
router.post("/post-session", postFutureSession);
router.get("/list-posts", listPosts);
router.get("/list-posts/:userId", listPosts);
router.delete("/delete:id", deleteFutureSession);
router.post("/add-comment", addComment);
router.get("/display-comment", displayComments);


export default router;
