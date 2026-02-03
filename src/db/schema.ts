import { doublePrecision, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Table for the users, deals with registraion/login and auth
 */
export const users = pgTable("User", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  bio: text("bio"),
  avatarUrl: text("avatarUrl"),
  email: text("email").notNull().unique(),
  password: text("password").notNull(),
  profileVisibility: text("profileVisibility").notNull().default("public"),
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
 * Table for user-created spots on the global map.
 */
export const spots = pgTable("Spot", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  latitude: doublePrecision("latitude").notNull(),
  longitude: doublePrecision("longitude").notNull(),
  description: text("description"),
  createdBy: text("createdBy")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
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
  spotId: text("spotId").references(() => spots.id, { onDelete: "set null" }),
  sport: text("sport").notNull(),
  time: timestamp("time", { precision: 3 }).notNull(),
  location: text("location").notNull(),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  notes: text("notes"),
  visibility: text("visibility").notNull().default("public"),
  allowedViewerIds: text("allowedViewerIds").array(),
  createdAt: timestamp("createdAt", { precision: 3 })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updatedAt", { precision: 3 })
    .notNull()
    .defaultNow(),
});

/**
 * Table for comments on future session posts
 */
export const futureSessionComments = pgTable("FutureSessionComment", {
  id: text("id").primaryKey(),
  postId: text("postId")
    .notNull()
    .references(() => futureSessions.id, { onDelete: "cascade" }),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  body: text("body").notNull(),
  createdAt: timestamp("createdAt", { precision: 3 })
    .notNull()
    .defaultNow(),
});

/**
 * Table for user blocks (privacy feature).
 */
export const userBlocks = pgTable("UserBlock", {
  id: text("id").primaryKey(),
  blockerId: text("blockerId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  blockedId: text("blockedId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("createdAt", { precision: 3 })
    .notNull()
    .defaultNow(),
});
