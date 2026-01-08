import type { Request, Response } from "express";

// Read the authenticated user id (set by auth middleware)
export function getAuthUserId(req: Request, res: Response): string | null {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ message: "Unauthorized" });
    return null;
  }
  return userId;
};