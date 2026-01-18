import express from "express";
import { authMiddleware } from "../middleware/auth.middleware.js";
import { postFutureSession, listPosts, deleteFutureSession, addComment, displayComments, listNearbySessions } from "../controllers/future-sessions.controller.js";

const router = express.Router();

router.use(authMiddleware);
router.post("/post-session", postFutureSession);
router.get("/list-posts", listPosts);
router.get("/list-posts/:userId", listPosts);
router.get("/nearby", listNearbySessions);
router.delete("/delete:id", deleteFutureSession);
router.post("/:id/add-comment", addComment);
router.get("/:id/display-comments", displayComments);


export default router;
