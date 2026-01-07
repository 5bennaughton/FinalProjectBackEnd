import jwt from "jsonwebtoken";
import { database } from "../db/db.js";
import { users } from "../db/schema.js"
import type { NextFunction } from "express";
import type { Request, Response } from "express";
import { eq } from "drizzle-orm";

// Read token from the request and check token is valid
export  const authMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;

  let token: string | undefined;
  
  if (authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.split(" ")[1];
  } else if (req.cookies?.jwt) {
    token = req.cookies.jwt;
  }

  if (!token) {
    res.status(401).json({ error: "Not authorized, no token provided"});
    return;
  }

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    res.status(500).json({ error: "JWT_SECRET not set" });
    return
  }

  try { 
    // Verify token is vaild and extract the user id
    const decoded = jwt.verify(token, secret) as { 
      sub: string;
      email: string;
      iat: number;
      exp: number;
    };
    console.log("Decoded token:", decoded); 
    console.log("Looking for user ID:", decoded.sub);

    const user = await database
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, decoded.sub))
      .limit(1);

      console.log("Found user:", user); 

    if (!user || user.length === 0) {
      res.status(401).json({ error: "user no longer exists"});
      return;
    }
    
    req.user = user[0]!;
    next();

  } catch (err) {
    res.status(401).json({ error: "Not authorized, token failed"});
    return;
  }
};
