import { doublePrecision, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Table for the users, deals with registraion/login and auth
 */
export const users = pgTable("User", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  password: text("password").notNull(),
  createdAt: timestamp("createdAt", { precision: 3 })
    .notNull()
    .defaultNow(),
});

/**
 * Table for friends, deals with requesting to befriend, and deals with finding friends
 */
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

/**
 * Table to store all the posts of users future session posts
 */
export const futureSessions = pgTable("FutureSession", {
  id: text("id").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  sport: text("sport").notNull(),
  time: timestamp("time", { precision: 3 }).notNull(),
  location: text("location").notNull(),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  notes: text("notes"),
  createdAt: timestamp("createdAt", { precision: 3 })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updatedAt", { precision: 3 })
    .notNull()
    .defaultNow(),
});
