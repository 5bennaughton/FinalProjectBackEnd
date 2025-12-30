import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const users = pgTable("User", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  password: text("password").notNull(),
  createdAt: timestamp("createdAt", { precision: 3 })
    .notNull()
    .defaultNow(),
});
