import fs from "node:fs/promises";
import path from "node:path";
import { pool } from "./db.js";

let hasBootstrappedSchema = false;

function splitSqlStatements(contents: string) {
  return contents
    .split(/;\s*(?:\r?\n|$)/)
    .map((statement) => statement.trim())
    .filter(Boolean);
}

export async function bootstrapDatabaseSchema() {
  if (hasBootstrappedSchema || process.env.NODE_ENV === "test") {
    return;
  }

  const migrationsPath = path.join(process.cwd(), "migrations.sql");
  const migrationsSql = await fs.readFile(migrationsPath, "utf8");
  const statements = splitSqlStatements(migrationsSql);

  for (const statement of statements) {
    await pool.query(statement);
  }

  hasBootstrappedSchema = true;
  console.log("Database schema bootstrap complete");
}
