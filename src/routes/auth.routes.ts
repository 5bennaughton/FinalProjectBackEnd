import express from "express";
import { register, login, logout, me, updateProfile, deleteMe } from "../controllers/auth.controller.js"
import { authMiddleware } from "../middleware/auth.middleware.js";

const router = express.Router();

router.post("/register", register);
router.post("/login", login);
router.post("/logout", logout);
router.get("/me", authMiddleware, me);
router.patch("/me", authMiddleware, updateProfile);
router.delete("/me", authMiddleware, deleteMe);

export default router;
