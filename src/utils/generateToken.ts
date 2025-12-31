import jwt from "jsonwebtoken";

export const generateToken = (userId: string, email?: string) => {
  const payload = email ? { sub: userId, email } : { sub: userId };

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET is not defined in environment variables");
  }

  return jwt.sign(payload, secret, {
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  } as jwt.SignOptions);
};
