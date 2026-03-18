import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  jsonb,
  index,
  real,
} from "drizzle-orm/pg-core";
import { authUsers } from "./auth.js";

export const scans = pgTable(
  "scans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    imageUrl: text("image_url").notNull(),
    thumbnailUrl: text("thumbnail_url"),
    status: varchar("status", { length: 20 })
      .notNull()
      .default("processing")
      .$type<"processing" | "completed" | "failed">(),
    activePlugin: varchar("active_plugin", { length: 100 }),
    metadata: jsonb("metadata").$type<ScanMetadata>().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("scans_user_id_idx").on(table.userId),
    index("scans_created_at_idx").on(table.createdAt),
    index("scans_status_idx").on(table.status),
  ],
);

export const scanResults = pgTable("scan_results", {
  id: uuid("id").primaryKey().defaultRandom(),
  scanId: uuid("scan_id")
    .notNull()
    .references(() => scans.id, { onDelete: "cascade" }),
  labels: jsonb("labels").$type<DetectedLabel[]>().notNull().default([]),
  summary: text("summary").notNull(),
  guidance: text("guidance").notNull(),
  rawVisionResponse: jsonb("raw_vision_response"),
  confidence: real("confidence"),
  processingTimeMs: real("processing_time_ms"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Scan = typeof scans.$inferSelect;
export type NewScan = typeof scans.$inferInsert;
export type ScanResult = typeof scanResults.$inferSelect;
export type NewScanResult = typeof scanResults.$inferInsert;

export interface ScanMetadata {
  deviceModel?: string;
  location?: { lat: number; lng: number };
  captureMode?: "single" | "continuous";
}

export interface DetectedLabel {
  name: string;
  confidence: number;
  boundingBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}
