import { eq } from "drizzle-orm";
import { database } from "../db/db.js";
import { users } from "../db/schema.js"
import bcrypt from "bcrypt";
import { generateToken } from "../utils/generateToken.js";
import type { Request, Response } from "express";
import { getAuthUserId } from "../helpers/helperFunctions.js";

/**
 * Register a new user and hash their password.
 * Validates required fields and rejects duplicate emails.
 */
export const register = async (req: Request, res: Response) => {
  const { name, email, password } = req.body ?? {};

    if (!name || !email || !password) {
    return res.status(400).json({ message: "Name, email, and password are required" });
  }

  const userExists = await database
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (userExists.length > 0) {
    return res.status(400).json({ message: "Email already exists" });
  };

  // Hash password 
  const salt = await bcrypt.genSalt(10)
  const hashedPassword = await bcrypt.hash(password, salt);

  //create user 
  await database.insert(users).values({
    id: crypto.randomUUID(),
    name,
    email,
    password: hashedPassword
  })

  res.status(201).json({ message: `Thanks for signing up ${name}` })
};

/**
 * Authenticate a user with email/password and issue a JWT cookie.
 * Returns basic user info and a token payload on success.
 */
export const login = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required" });
    }

    // Find user by email
    const found = await database
      .select({
        id: users.id,
        email: users.email,
        password: users.password,
        name: users.name,
        avatarUrl: users.avatarUrl,
        bio: users.bio,
      })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    const user = found[0];
    if (!user) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const token = generateToken(user.id, user.email);

    const isProduction = process.env.NODE_ENV === "production";
    res.cookie("jwt", token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: "strict",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    return res.status(200).json({
      user: {
        id: user.id,
        email: email,
        name: user.name,
        bio: user.bio ?? null,
        avatarUrl: user.avatarUrl ?? null,
      },
       token: token,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  }
};

/**
 * Clear the auth cookie to log the user out.
 */
export const logout = async (req: Request, res: Response) => {
  res.cookie("jwt", "", {
    httpOnly: true,
    expires: new Date(0),
  });

  res.status(200).json({
    status: "success",
    message: "Logged out successfully",
  })
}

/**
 * Return basic profile data for the authenticated user.
 * Responds with 404 if the user no longer exists.
 */
export const me = async (req: Request, res: Response) => {
  try {
    const userId = getAuthUserId(req, res);
    if (!userId) return;

    const found = await database
      .select({ name: users.name, bio: users.bio, avatarUrl: users.avatarUrl })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    const user = found[0];
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.status(200).json({
      name: user.name,
      bio: user.bio ?? null,
      avatarUrl: user.avatarUrl ?? null,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  }
};

/**
 * Update the authenticated user's profile fields.
 * Supports name and bio updates in a single call.
 */
export const updateProfile = async (req: Request, res: Response) => {
  try {
    const userId = getAuthUserId(req, res);
    if (!userId) return;

    const updates: {
      name?: string;
      bio?: string | null;
      avatarUrl?: string | null;
    } = {};

    if (req.body?.name !== undefined) {
      if (typeof req.body.name !== "string") {
        return res.status(400).json({ message: "Name must be a string" });
      }
      const trimmed = req.body.name.trim();
      if (!trimmed) {
        return res.status(400).json({ message: "Name is required" });
      }
      updates.name = trimmed;
    }

    if (req.body?.bio !== undefined) {
      if (typeof req.body.bio !== "string") {
        return res.status(400).json({ message: "Bio must be a string" });
      }
      const trimmed = req.body.bio.trim();
      // Empty string clears the bio.
      updates.bio = trimmed ? trimmed : null;
    }

    if (req.body?.avatarUrl !== undefined) {
      if (typeof req.body.avatarUrl !== "string") {
        return res.status(400).json({ message: "Avatar URL must be a string" });
      }
      const trimmed = req.body.avatarUrl.trim();
      // Empty string clears the avatar.
      updates.avatarUrl = trimmed ? trimmed : null;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: "No profile fields provided" });
    }

    const updated = await database
      .update(users)
      .set(updates)
      .where(eq(users.id, userId))
      .returning({
        name: users.name,
        bio: users.bio,
        avatarUrl: users.avatarUrl,
      });

    const user = updated[0];
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.status(200).json({
      name: user.name,
      bio: user.bio ?? null,
      avatarUrl: user.avatarUrl ?? null,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  }
};
