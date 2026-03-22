import express from "express";
import { authMiddleware } from "../middleware/auth.middleware.js";
import {
  blockUser,
  getUserProfile,
  listBlockedUsers,
  unblockUser,
  updateUserRole,
} from "../controllers/users.controller.js";

const router = express.Router();

router.use(authMiddleware);
router.get("/blocked", listBlockedUsers);
router.patch("/:userId/role", updateUserRole);
router.post("/:userId/block", blockUser);
router.delete("/:userId/block", unblockUser);
router.get("/:userId", getUserProfile);

export default router;
