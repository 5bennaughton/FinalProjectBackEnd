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

export const friendRequests = pgTable("FriendRequest", {
  id: text("id").primaryKey(),
  requesterId: text("requesterId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  addresseeId: text("addresseeId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  status: text("status").notNull(),
  createdAt: timestamp("createdAt", { precision: 3 })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updatedAt", { precision: 3 })
    .notNull()
    .defaultNow(),
});
