import {
  pgTable,
  uuid,
  text,
  varchar,
  timestamp,
  jsonb,
  boolean,
  index,
  integer,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { authUsers } from "./auth.js";
import { memories } from "./memories.js";

// ---------------------------------------------------------------------------
// Scavenger Hunts
// ---------------------------------------------------------------------------

export interface ScavengerHuntItem {
  name: string;
  found: boolean;
  hint?: string;
}

export const scavengerHunts = pgTable(
  "scavenger_hunts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    creatorId: text("creator_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 255 }).notNull(),
    description: text("description"),
    items: jsonb("items").$type<ScavengerHuntItem[]>().notNull().default([]),
    difficulty: varchar("difficulty", { length: 20 })
      .notNull()
      .default("medium")
      .$type<"easy" | "medium" | "hard">(),
    timeLimit: integer("time_limit"),
    isPublic: boolean("is_public").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("scavenger_hunts_creator_id_idx").on(table.creatorId),
    index("scavenger_hunts_is_public_idx").on(table.isPublic),
    index("scavenger_hunts_created_at_idx").on(table.createdAt),
  ],
);

export type ScavengerHunt = typeof scavengerHunts.$inferSelect;
export type NewScavengerHunt = typeof scavengerHunts.$inferInsert;

// ---------------------------------------------------------------------------
// Hunt Participants
// ---------------------------------------------------------------------------

export interface FoundItem {
  name: string;
  foundAt: string;
  confidence: number;
}

export const huntParticipants = pgTable(
  "hunt_participants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    huntId: uuid("hunt_id")
      .notNull()
      .references(() => scavengerHunts.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    foundItems: jsonb("found_items").$type<FoundItem[]>().notNull().default([]),
    score: integer("score").notNull().default(0),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("hunt_participants_hunt_id_idx").on(table.huntId),
    index("hunt_participants_user_id_idx").on(table.userId),
    index("hunt_participants_score_idx").on(table.score),
  ],
);

export type HuntParticipant = typeof huntParticipants.$inferSelect;
export type NewHuntParticipant = typeof huntParticipants.$inferInsert;

// ---------------------------------------------------------------------------
// Time Capsules
// ---------------------------------------------------------------------------

export interface TimeCapsuleChanges {
  added: string[];
  removed: string[];
  moved: string[];
}

export const timeCapsules = pgTable(
  "time_capsules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 255 }).notNull(),
    location: varchar("location", { length: 255 }),
    originalScan: jsonb("original_scan")
      .$type<{ name: string; confidence: number }[]>()
      .notNull()
      .default([]),
    originalImageUrl: text("original_image_url"),
    latestScan: jsonb("latest_scan")
      .$type<{ name: string; confidence: number }[]>(),
    latestImageUrl: text("latest_image_url"),
    changes: jsonb("changes").$type<TimeCapsuleChanges>(),
    scanCount: integer("scan_count").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("time_capsules_user_id_idx").on(table.userId),
    index("time_capsules_created_at_idx").on(table.createdAt),
  ],
);

export type TimeCapsule = typeof timeCapsules.$inferSelect;
export type NewTimeCapsule = typeof timeCapsules.$inferInsert;

// ---------------------------------------------------------------------------
// Social Posts (Identify That)
// ---------------------------------------------------------------------------

export const socialPosts = pgTable(
  "social_posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    imageUrl: text("image_url").notNull(),
    question: text("question").notNull(),
    aiSuggestion: text("ai_suggestion"),
    status: varchar("status", { length: 20 })
      .notNull()
      .default("open")
      .$type<"open" | "solved" | "closed">(),
    solvedAnswer: text("solved_answer"),
    upvotes: integer("upvotes").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("social_posts_user_id_idx").on(table.userId),
    index("social_posts_status_idx").on(table.status),
    index("social_posts_created_at_idx").on(table.createdAt),
    index("social_posts_upvotes_idx").on(table.upvotes),
  ],
);

export type SocialPost = typeof socialPosts.$inferSelect;
export type NewSocialPost = typeof socialPosts.$inferInsert;

// ---------------------------------------------------------------------------
// Social Comments
// ---------------------------------------------------------------------------

export const socialComments = pgTable(
  "social_comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    postId: uuid("post_id")
      .notNull()
      .references(() => socialPosts.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    isAnswer: boolean("is_answer").notNull().default(false),
    upvotes: integer("upvotes").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("social_comments_post_id_idx").on(table.postId),
    index("social_comments_user_id_idx").on(table.userId),
  ],
);

export type SocialComment = typeof socialComments.$inferSelect;
export type NewSocialComment = typeof socialComments.$inferInsert;

// ---------------------------------------------------------------------------
// Achievements
// ---------------------------------------------------------------------------

export const achievements = pgTable(
  "achievements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    type: varchar("type", { length: 50 }).notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    description: text("description").notNull(),
    icon: varchar("icon", { length: 10 }).notNull(),
    unlockedAt: timestamp("unlocked_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
  },
  (table) => [
    index("achievements_user_id_idx").on(table.userId),
    index("achievements_type_idx").on(table.type),
  ],
);

export type Achievement = typeof achievements.$inferSelect;
export type NewAchievement = typeof achievements.$inferInsert;

// ---------------------------------------------------------------------------
// User Streaks
// ---------------------------------------------------------------------------

export const userStreaks = pgTable(
  "user_streaks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    currentStreak: integer("current_streak").notNull().default(0),
    longestStreak: integer("longest_streak").notNull().default(0),
    lastScanDate: timestamp("last_scan_date", { withTimezone: true }),
    totalScans: integer("total_scans").notNull().default(0),
    totalObjects: integer("total_objects").notNull().default(0),
    xp: integer("xp").notNull().default(0),
    level: integer("level").notNull().default(1),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("user_streaks_user_id_idx").on(table.userId),
    index("user_streaks_xp_idx").on(table.xp),
    index("user_streaks_level_idx").on(table.level),
  ],
);

export type UserStreak = typeof userStreaks.$inferSelect;
export type NewUserStreak = typeof userStreaks.$inferInsert;

// ---------------------------------------------------------------------------
// Smart Reminders
// ---------------------------------------------------------------------------

export const reminders = pgTable(
  "reminders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    memoryId: uuid("memory_id").references(() => memories.id, {
      onDelete: "set null",
    }),
    title: varchar("title", { length: 255 }).notNull(),
    description: text("description"),
    reminderDate: timestamp("reminder_date", { withTimezone: true }).notNull(),
    type: varchar("type", { length: 30 })
      .notNull()
      .default("custom")
      .$type<"expiry" | "warranty" | "maintenance" | "custom">(),
    isCompleted: boolean("is_completed").notNull().default(false),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("reminders_user_id_idx").on(table.userId),
    index("reminders_reminder_date_idx").on(table.reminderDate),
    index("reminders_is_completed_idx").on(table.userId, table.isCompleted),
    index("reminders_memory_id_idx").on(table.memoryId),
  ],
);

export type Reminder = typeof reminders.$inferSelect;
export type NewReminder = typeof reminders.$inferInsert;

// ---------------------------------------------------------------------------
// Collections (What's It Worth)
// ---------------------------------------------------------------------------

export const collections = pgTable(
  "collections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    category: varchar("category", { length: 50 }),
    totalValue: varchar("total_value", { length: 50 }),
    itemCount: integer("item_count").notNull().default(0),
    coverImageUrl: text("cover_image_url"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("collections_user_id_idx").on(table.userId),
    index("collections_category_idx").on(table.category),
    index("collections_created_at_idx").on(table.createdAt),
  ],
);

export type Collection = typeof collections.$inferSelect;
export type NewCollection = typeof collections.$inferInsert;

// ---------------------------------------------------------------------------
// Collection Items
// ---------------------------------------------------------------------------

export const collectionItems = pgTable(
  "collection_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    collectionId: uuid("collection_id")
      .notNull()
      .references(() => collections.id, { onDelete: "cascade" }),
    memoryId: uuid("memory_id").references(() => memories.id, {
      onDelete: "set null",
    }),
    name: varchar("name", { length: 255 }).notNull(),
    imageUrl: text("image_url"),
    estimatedValue: varchar("estimated_value", { length: 50 }),
    notes: text("notes"),
    condition: varchar("condition", { length: 20 }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("collection_items_collection_id_idx").on(table.collectionId),
    index("collection_items_memory_id_idx").on(table.memoryId),
  ],
);

export type CollectionItem = typeof collectionItems.$inferSelect;
export type NewCollectionItem = typeof collectionItems.$inferInsert;
