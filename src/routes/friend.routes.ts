import express from "express";
import { authMiddleware } from "../middleware/auth.middleware.js";
import {
  createFriendRequest,
  listFriends,
  listFriendRequests,
  respondToFriendRequest,
  searchUsers,
} from "../controllers/friend.controller.js";

const router = express.Router();

router.use(authMiddleware);

router.get("/search", searchUsers);
router.post("/requests", createFriendRequest);
router.get("/list-requests", listFriendRequests);
router.patch("/requests-re/:id", respondToFriendRequest);
router.get("/list", listFriends);

export default router;
