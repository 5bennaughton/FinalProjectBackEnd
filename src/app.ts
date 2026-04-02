import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import cookieParser from "cookie-parser";

// Import Routes
import authRoutes from "./routes/auth.routes.js";
import friendRoutes from "./routes/friend.routes.js";
import futureSessionRoutes from "./routes/future-sessions.router.js";
import feedRoutes from "./routes/feed.routes.js";
import geoRoutes from "./routes/geo.routes.js";
import globalSpotsRoutes from "./routes/global-spots.router.js";
import uploadRoutes from "./routes/uploads.routes.js";
import usersRoutes from "./routes/users.routes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const app = express();

const defaultOrigins = [
  "http://localhost:8081",
  "http://localhost:19006",
  "http://127.0.0.1:8081",
  "http://127.0.0.1:19006",
];

const configuredOrigins = process.env.FRONTEND_URL
  ? process.env.FRONTEND_URL.split(",").map((origin) => origin.trim())
  : [];

const allowedOrigins = [...new Set([...defaultOrigins, ...configuredOrigins])];

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error(`Origin not allowed by CORS: ${origin}`));
    },
    credentials: true,
  })
);
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// API Routes
app.use("/auth", authRoutes);
app.use("/friends", friendRoutes);
app.use("/future-sessions", futureSessionRoutes);
app.use("/feed", feedRoutes);
app.use("/geo", geoRoutes);
app.use("/global-spots", globalSpotsRoutes);
app.use("/uploads", uploadRoutes);
app.use("/users", usersRoutes);
app.use("/uploads", express.static(path.join(__dirname, "..", "uploads")));
