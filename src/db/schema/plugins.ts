import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  boolean,
  jsonb,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { authUsers } from "./auth.js";

export const plugins = pgTable("plugins", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: varchar("slug", { length: 100 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description").notNull(),
  version: varchar("version", { length: 20 }).notNull().default("1.0.0"),
  iconUrl: text("icon_url"),
  enabled: boolean("enabled").notNull().default(true),
  configSchema: jsonb("config_schema").$type<Record<string, unknown>>().default({}),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const userPlugins = pgTable(
  "user_plugins",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    pluginId: uuid("plugin_id")
      .notNull()
      .references(() => plugins.id, { onDelete: "cascade" }),
    active: boolean("active").notNull().default(true),
    config: jsonb("config").$type<Record<string, unknown>>().default({}),
    activatedAt: timestamp("activated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("user_plugins_user_plugin_idx").on(
      table.userId,
      table.pluginId,
    ),
  ],
);

export type Plugin = typeof plugins.$inferSelect;
export type NewPlugin = typeof plugins.$inferInsert;
export type UserPlugin = typeof userPlugins.$inferSelect;
export type NewUserPlugin = typeof userPlugins.$inferInsert;
