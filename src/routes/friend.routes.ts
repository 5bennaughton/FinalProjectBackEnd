import express from "express";
import { authMiddleware } from "../middleware/auth.middleware.js";
import {
  createFriendRequest,
  listFriendRequests,
  respondToFriendRequest,
  searchUsers,
} from "../controllers/friend.controller.js";

const router = express.Router();

router.use(authMiddleware);

router.get("/search", searchUsers);
router.post("/requests", createFriendRequest);
router.get("/list-requests", listFriendRequests);
router.patch("/requests/:id", respondToFriendRequest);

export default router;
