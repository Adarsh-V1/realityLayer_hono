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
} from "drizzle-orm/pg-core";
import { authUsers } from "./auth.js";
import { scans } from "./scans.js";

export const memories = pgTable(
  "memories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    scanId: uuid("scan_id").references(() => scans.id, {
      onDelete: "set null",
    }),
    title: varchar("title", { length: 255 }).notNull(),
    category: varchar("category", { length: 50 })
      .notNull()
      .default("general")
      .$type<MemoryCategory>(),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    objects: jsonb("objects").$type<MemoryObject[]>().notNull().default([]),
    imageUrl: text("image_url"),
    thumbnailUrl: text("thumbnail_url"),
    notes: text("notes"),
    isFavorite: boolean("is_favorite").notNull().default(false),
    metadata: jsonb("metadata").$type<MemoryMetadata>().default({}),
    objectCount: integer("object_count").notNull().default(0),
    totalValue: varchar("total_value", { length: 50 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("memories_user_id_idx").on(table.userId),
    index("memories_category_idx").on(table.category),
    index("memories_created_at_idx").on(table.createdAt),
    index("memories_is_favorite_idx").on(table.userId, table.isFavorite),
    index("memories_scan_id_idx").on(table.scanId),
  ],
);

export type Memory = typeof memories.$inferSelect;
export type NewMemory = typeof memories.$inferInsert;

export type MemoryCategory =
  | "general"
  | "electronics"
  | "furniture"
  | "clothing"
  | "food"
  | "vehicle"
  | "nature"
  | "art"
  | "sports"
  | "tools"
  | "other";

export interface MemoryObject {
  name: string;
  confidence: number;
  summary: string;
  recommendation: string;
  price: string;
}

export interface MemoryMetadata {
  scanDuration?: number;
  pluginsUsed?: string[];
  location?: { lat: number; lng: number };
  deviceModel?: string;
}
