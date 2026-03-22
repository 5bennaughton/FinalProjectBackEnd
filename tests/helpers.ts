import bcrypt from "bcrypt";
import { randomUUID } from "node:crypto";
import { database } from "../src/db/db.js";
import {
  friendRequests,
  futureSessions,
  spots,
  userBlocks,
  users,
} from "../src/db/schema.js";
import { generateToken } from "../src/utils/generateToken.js";

type CreateUserOptions = {
  id?: string;
  name?: string;
  email?: string;
  password?: string;
  bio?: string | null;
  avatarUrl?: string | null;
  role?: "user" | "admin";
  profileVisibility?: "public" | "friends" | "private";
};

type CreateSpotOptions = {
  id?: string;
  createdBy: string;
  name?: string;
  type?: string;
  latitude?: number;
  longitude?: number;
  description?: string | null;
  windDirStart?: number | null;
  windDirEnd?: number | null;
  isTidal?: boolean | null;
  tidePreference?: string | null;
  tideWindowHours?: number | null;
};

type CreateFutureSessionOptions = {
  id?: string;
  userId: string;
  spotId?: string | null;
  sport?: string;
  time?: Date;
  location?: string;
  latitude?: number | null;
  longitude?: number | null;
  visibility?: "public" | "friends" | "private" | "custom";
  allowedViewerIds?: string[] | null;
};

export async function createUser(options: CreateUserOptions = {}) {
  const plainPassword = options.password ?? "secret123";
  const hashedPassword = await bcrypt.hash(plainPassword, 10);

  const user = {
    id: options.id ?? randomUUID(),
    name: options.name ?? "Test User",
    email:
      options.email ??
      `user-${Math.random().toString(36).slice(2, 10)}@example.com`,
    password: hashedPassword,
    bio: options.bio ?? null,
    avatarUrl: options.avatarUrl ?? null,
    role: options.role ?? "user",
    profileVisibility: options.profileVisibility ?? "public",
  };

  await database.insert(users).values(user);

  return {
    ...user,
    plainPassword,
  };
}

export function authHeaderFor(userId: string, email?: string) {
  return {
    Authorization: `Bearer ${generateToken(userId, email)}`,
  };
}

export async function createAcceptedFriendship(userA: string, userB: string) {
  await database.insert(friendRequests).values({
    id: randomUUID(),
    requesterId: userA,
    addresseeId: userB,
    status: "accepted",
  });
}

export async function createBlock(blockerId: string, blockedId: string) {
  await database.insert(userBlocks).values({
    id: randomUUID(),
    blockerId,
    blockedId,
  });
}

export async function createSpotRecord(options: CreateSpotOptions) {
  const spot = {
    id: options.id ?? randomUUID(),
    name: options.name ?? "Test Spot",
    type: options.type ?? "kitesurfing",
    latitude: options.latitude ?? 52.1,
    longitude: options.longitude ?? -6.9,
    description: options.description ?? null,
    windDirStart: options.windDirStart ?? null,
    windDirEnd: options.windDirEnd ?? null,
    isTidal: options.isTidal ?? null,
    tidePreference: options.tidePreference ?? null,
    tideWindowHours: options.tideWindowHours ?? null,
    createdBy: options.createdBy,
  };

  await database.insert(spots).values(spot);
  return spot;
}

export async function createFutureSessionRecord(
  options: CreateFutureSessionOptions
) {
  const session = {
    id: options.id ?? randomUUID(),
    userId: options.userId,
    spotId: options.spotId ?? null,
    sport: options.sport ?? "kitesurfing",
    time: options.time ?? new Date(Date.now() + 60 * 60 * 1000),
    location: options.location ?? "Dollymount",
    latitude: options.latitude ?? 53.36,
    longitude: options.longitude ?? -6.15,
    visibility: options.visibility ?? "public",
    allowedViewerIds: options.allowedViewerIds ?? null,
  };

  await database.insert(futureSessions).values(session);
  return session;
}
