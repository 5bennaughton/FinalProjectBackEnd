import express from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { authMiddleware } from "../middleware/auth.middleware.js";
import { getAuthUserId } from "../helpers/helperFunctions.js";

const router = express.Router();

const uploadRoot = path.resolve("uploads");
const avatarDir = path.join(uploadRoot, "avatars");

// Ensure the uploads folder exists on server start.
fs.mkdirSync(avatarDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, avatarDir);
  },
  filename: (req, file, cb) => {
    const userId = req.user?.id ?? "user";
    const ext = path.extname(file.originalname) || ".jpg";
    cb(null, `${userId}-${randomUUID()}${ext.toLowerCase()}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("Only image uploads are allowed"));
    }
    return cb(null, true);
  },
});

/**
 * Upload a profile avatar for the authenticated user.
 * Returns a public URL for the uploaded file.
 */
router.post(
  "/avatar",
  authMiddleware,
  upload.single("avatar"),
  (req, res) => {
    const userId = getAuthUserId(req, res);
    if (!userId) return;

    if (!req.file) {
      return res.status(400).json({ message: "Avatar file is required" });
    }

    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const publicUrl = `${baseUrl}/uploads/avatars/${req.file.filename}`;

    return res.status(201).json({ avatarUrl: publicUrl });
  }
);

// Handle upload errors in a simple, consistent way.
router.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = err instanceof Error ? err.message : "Upload failed";
  return res.status(400).json({ message });
});

export default router;
