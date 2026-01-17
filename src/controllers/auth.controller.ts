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
      user: { id: user.id, email: email },
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
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    const user = found[0];
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.status(200).json({ name: user.name });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  }
};
