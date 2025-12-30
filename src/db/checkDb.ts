import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const db = drizzle(pool);

export async function checkDbConnection() {
  try {
    await db.execute(sql`select 1`);
    console.log("✅ DB connected");
    return true;
  } catch (err) {
    console.error("❌ DB NOT connected", err);
    return false;
  }
}
