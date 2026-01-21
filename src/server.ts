import express from "express";
import { config } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./db/db.js";
import { checkDbConnection } from "./db/checkDb.js"


// Import Routes
import authStravaRoutes from "./routes/oauth.routes.js";
import sessionsRoutes from "./routes/session.routes.js"
import authRoutes from "./routes/auth.routes.js"
import friendRoutes from "./routes/friend.routes.js"
import futureSessionRoutes from "./routes/future-sessions.router.js"
import feedRoutes from "./routes/feed.routes.js";
import geoRoutes from "./routes/geo.routes.js";
import globalSpotsRoutes from "./routes/global-spots.router.js";
import uploadRoutes from "./routes/uploads.routes.js";
import usersRoutes from "./routes/users.routes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json());

config();

app.use(express.json());
app.use(express.urlencoded({ extended:true }))

// API Routes
app.use("/oauth", authStravaRoutes);
app.use("/sessions", sessionsRoutes);
app.use("/auth", authRoutes);
app.use("/friends", friendRoutes);
app.use("/future-sessions", futureSessionRoutes);
app.use("/feed", feedRoutes);
app.use("/geo", geoRoutes);
app.use("/global-spots", globalSpotsRoutes);
app.use("/uploads", uploadRoutes);
app.use("/users", usersRoutes);
app.use("/uploads", express.static(path.join(__dirname, "..", "uploads")));


const PORT = 5001;
const server = app.listen(PORT, "0.0.0.0", () => console.log(`Server running on PORT ${PORT}`));
console.log(await checkDbConnection())

const shutdown = (signal: any) => {
  console.log(`${signal} received, shutting down...`);
  server.close(async () => {
    try {
      await pool.end();
      console.log("DB pool closed.");
      process.exit(0);
    } catch (err) {
      console.error("Failed to close DB pool:", err);
      process.exit(1);
    }
  });
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT")); 

process.on("unhandledRejection", (err) => {
  console.error("Unhandled Rejection:", err);
  shutdown("unhandledRejection");
});

process.on("uncaughtException", async (err) => {
  console.error("Uncaught Exception:", err);
  try { await pool.end(); } catch {}
  process.exit(1);
});
