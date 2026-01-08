import type { Request, Response } from "express";
import { getString } from "../controllers/friend.controller.js";
import { database } from "../db/db.js";
import { and, ilike, ne, or } from "drizzle-orm";
import { users } from "../db/schema.js";

// Read the authenticated user id (set by auth middleware)
export function getAuthUserId(req: Request, res: Response): string | null {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ message: "Unauthorized" });
    return null;
  }
  return userId;
};

// Search users by name or email, excluding the current user
export async function searchUsers(req: Request, res: Response) {
  try {
    const userId = getAuthUserId(req, res);
    if (!userId) return;

    const query = getString(req.query.q);
    if (!query) {
      return res.status(400).json({ message: "q is required" });
    }

    // Case-insensitive search on name or email to users db
    const matches = await database
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(
        and(
          or(
            ilike(users.name, `%${query}%`),
            ilike(users.email, `%${query}%`)
          ),
          ne(users.id, userId)
        )
      )
      .limit(20);

    return res.status(200).json({ users: matches });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  }
};