import express from "express";
import { authMiddleware } from "../middleware/auth.middleware.js";
import {
  createFriendRequest,
  listFriends,
  listFriendRequests,
  respondToFriendRequest,
} from "../controllers/friend.controller.js";
import { searchUsers } from "../helpers/helperFunctions.js";

const router = express.Router();

router.use(authMiddleware);

router.get("/search-users", searchUsers);
router.post("/requests", createFriendRequest);
router.get("/list-requests", listFriendRequests);
router.patch("/requests-re/:id", respondToFriendRequest);
router.get("/list", listFriends);

export default router;
