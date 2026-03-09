import { app } from "./app.js";
import { pool } from "./db/db.js";
import { checkDbConnection } from "./db/checkDb.js";

const PORT = 5001;
const server = app.listen(PORT, "0.0.0.0", () =>
  console.log(`Server running on PORT ${PORT}`)
);
console.log(await checkDbConnection());

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
  try {
    await pool.end();
  } catch {}
  process.exit(1);
});
