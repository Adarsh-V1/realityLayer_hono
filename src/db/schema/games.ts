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
  real,
} from "drizzle-orm/pg-core";
import { authUsers } from "./auth.js";

// ============================================================================
// SHARED TYPES
// ============================================================================

export interface RRInventoryItem {
  id: string;
  lootType: "weapon" | "shield" | "health" | "special";
  name: string;
  rarity: "common" | "uncommon" | "rare" | "epic" | "legendary";
  power: number;
  scannedFrom: string;
}

export interface TycoonDecor {
  theme?: string;
  wallColor?: string;
  floorType?: string;
  lighting?: string;
  extras?: string[];
}

// ============================================================================
// SCAN TYCOON
// ============================================================================

export const tycoonShops = pgTable(
  "tycoon_shops",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull().default("My Shop"),
    level: integer("level").notNull().default(1),
    coins: integer("coins").notNull().default(100),
    totalEarned: integer("total_earned").notNull().default(0),
    reputation: integer("reputation").notNull().default(0),
    displayCases: integer("display_cases").notNull().default(4),
    staffCount: integer("staff_count").notNull().default(0),
    decor: jsonb("decor").$type<TycoonDecor>().notNull().default({}),
    lastIdleCollect: timestamp("last_idle_collect", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("tycoon_shops_user_id_idx").on(table.userId),
    index("tycoon_shops_level_idx").on(table.level),
    index("tycoon_shops_total_earned_idx").on(table.totalEarned),
  ],
);

export type TycoonShop = typeof tycoonShops.$inferSelect;
export type NewTycoonShop = typeof tycoonShops.$inferInsert;

export const tycoonInventory = pgTable(
  "tycoon_inventory",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => tycoonShops.id, { onDelete: "cascade" }),
    objectName: varchar("object_name", { length: 255 }).notNull(),
    objectCategory: varchar("object_category", { length: 50 }),
    rarity: varchar("rarity", { length: 20 })
      .notNull()
      .$type<"common" | "uncommon" | "rare" | "epic" | "legendary">(),
    baseValue: integer("base_value").notNull(),
    listedPrice: integer("listed_price"),
    isDisplayed: boolean("is_displayed").notNull().default(false),
    imageUrl: text("image_url"),
    scannedObjectData: jsonb("scanned_object_data").$type<
      Record<string, unknown>
    >(),
    addedAt: timestamp("added_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    soldAt: timestamp("sold_at", { withTimezone: true }),
  },
  (table) => [
    index("tycoon_inventory_shop_id_idx").on(table.shopId),
    index("tycoon_inventory_rarity_idx").on(table.rarity),
    index("tycoon_inventory_is_displayed_idx").on(table.isDisplayed),
    index("tycoon_inventory_sold_at_idx").on(table.soldAt),
  ],
);

export type TycoonInventoryItem = typeof tycoonInventory.$inferSelect;
export type NewTycoonInventoryItem = typeof tycoonInventory.$inferInsert;

export const tycoonTransactions = pgTable(
  "tycoon_transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => tycoonShops.id, { onDelete: "cascade" }),
    inventoryItemId: uuid("inventory_item_id").references(
      () => tycoonInventory.id,
      { onDelete: "set null" },
    ),
    type: varchar("type", { length: 20 })
      .notNull()
      .$type<"sale" | "idle_income" | "upgrade_cost" | "staff_hire">(),
    amount: integer("amount").notNull(),
    customerName: varchar("customer_name", { length: 100 }),
    customerReaction: varchar("customer_reaction", { length: 20 }).$type<
      "happy" | "neutral" | "unhappy" | "thrilled"
    >(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("tycoon_transactions_shop_id_idx").on(table.shopId),
    index("tycoon_transactions_type_idx").on(table.type),
    index("tycoon_transactions_created_at_idx").on(table.createdAt),
  ],
);

export type TycoonTransaction = typeof tycoonTransactions.$inferSelect;
export type NewTycoonTransaction = typeof tycoonTransactions.$inferInsert;

export const tycoonUpgrades = pgTable(
  "tycoon_upgrades",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => tycoonShops.id, { onDelete: "cascade" }),
    upgradeType: varchar("upgrade_type", { length: 50 })
      .notNull()
      .$type<
        "display_case" | "decor" | "staff" | "location" | "advertising"
      >(),
    level: integer("level").notNull().default(1),
    purchasedAt: timestamp("purchased_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("tycoon_upgrades_shop_id_idx").on(table.shopId),
    uniqueIndex("tycoon_upgrades_shop_type_idx").on(
      table.shopId,
      table.upgradeType,
    ),
  ],
);

export type TycoonUpgrade = typeof tycoonUpgrades.$inferSelect;
export type NewTycoonUpgrade = typeof tycoonUpgrades.$inferInsert;

// ============================================================================
// OBJECT ALCHEMIST
// ============================================================================

export const alchemyRecipes = pgTable(
  "alchemy_recipes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    inputA: varchar("input_a", { length: 255 }).notNull(),
    inputB: varchar("input_b", { length: 255 }).notNull(),
    resultName: varchar("result_name", { length: 255 }).notNull(),
    resultDescription: text("result_description").notNull(),
    resultImagePrompt: text("result_image_prompt"),
    category: varchar("category", { length: 50 })
      .notNull()
      .$type<
        | "gadgets"
        | "food"
        | "transport"
        | "fashion"
        | "tools"
        | "magic"
        | "nature"
        | "misc"
      >(),
    rarity: varchar("rarity", { length: 20 })
      .notNull()
      .$type<
        "common" | "uncommon" | "rare" | "epic" | "legendary" | "golden"
      >(),
    isGolden: boolean("is_golden").notNull().default(false),
    timesDiscovered: integer("times_discovered").notNull().default(0),
    firstDiscoveredBy: text("first_discovered_by").references(
      () => authUsers.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("alchemy_recipes_inputs_idx").on(table.inputA, table.inputB),
    index("alchemy_recipes_category_idx").on(table.category),
    index("alchemy_recipes_rarity_idx").on(table.rarity),
    index("alchemy_recipes_golden_idx").on(table.isGolden),
  ],
);

export type AlchemyRecipe = typeof alchemyRecipes.$inferSelect;
export type NewAlchemyRecipe = typeof alchemyRecipes.$inferInsert;

export const alchemyDiscoveries = pgTable(
  "alchemy_discoveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    recipeId: uuid("recipe_id")
      .notNull()
      .references(() => alchemyRecipes.id, { onDelete: "cascade" }),
    inputAScanObject: varchar("input_a_scan_object", {
      length: 255,
    }).notNull(),
    inputBScanObject: varchar("input_b_scan_object", {
      length: 255,
    }).notNull(),
    isFirstDiscovery: boolean("is_first_discovery").notNull().default(false),
    discoveredAt: timestamp("discovered_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("alchemy_discoveries_user_id_idx").on(table.userId),
    index("alchemy_discoveries_recipe_id_idx").on(table.recipeId),
    uniqueIndex("alchemy_discoveries_user_recipe_idx").on(
      table.userId,
      table.recipeId,
    ),
  ],
);

export type AlchemyDiscovery = typeof alchemyDiscoveries.$inferSelect;
export type NewAlchemyDiscovery = typeof alchemyDiscoveries.$inferInsert;

export const alchemyLeaderboard = pgTable(
  "alchemy_leaderboard",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    totalDiscoveries: integer("total_discoveries").notNull().default(0),
    goldenCount: integer("golden_count").notNull().default(0),
    rareCount: integer("rare_count").notNull().default(0),
    firstDiscoveries: integer("first_discoveries").notNull().default(0),
    score: integer("score").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("alchemy_leaderboard_user_id_idx").on(table.userId),
    index("alchemy_leaderboard_score_idx").on(table.score),
  ],
);

export type AlchemyLeaderboardEntry = typeof alchemyLeaderboard.$inferSelect;
export type NewAlchemyLeaderboardEntry =
  typeof alchemyLeaderboard.$inferInsert;

// ============================================================================
// REALITY ROYALE
// ============================================================================

export const rrMatches = pgTable(
  "rr_matches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    creatorId: text("creator_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    status: varchar("status", { length: 20 })
      .notNull()
      .default("lobby")
      .$type<"lobby" | "countdown" | "active" | "shrinking" | "finished">(),
    centerLat: real("center_lat").notNull(),
    centerLng: real("center_lng").notNull(),
    initialRadius: real("initial_radius").notNull().default(500),
    currentRadius: real("current_radius").notNull().default(500),
    shrinkRate: real("shrink_rate").notNull().default(10),
    maxPlayers: integer("max_players").notNull().default(20),
    matchDuration: integer("match_duration").notNull().default(600),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    winnerId: text("winner_id").references(() => authUsers.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("rr_matches_status_idx").on(table.status),
    index("rr_matches_creator_id_idx").on(table.creatorId),
    index("rr_matches_created_at_idx").on(table.createdAt),
  ],
);

export type RRMatch = typeof rrMatches.$inferSelect;
export type NewRRMatch = typeof rrMatches.$inferInsert;

export const rrPlayers = pgTable(
  "rr_players",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    matchId: uuid("match_id")
      .notNull()
      .references(() => rrMatches.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    health: integer("health").notNull().default(100),
    shield: integer("shield").notNull().default(0),
    kills: integer("kills").notNull().default(0),
    isAlive: boolean("is_alive").notNull().default(true),
    lastLat: real("last_lat"),
    lastLng: real("last_lng"),
    lastLocationAt: timestamp("last_location_at", { withTimezone: true }),
    inventory: jsonb("inventory")
      .$type<RRInventoryItem[]>()
      .notNull()
      .default([]),
    placementRank: integer("placement_rank"),
    joinedAt: timestamp("joined_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    eliminatedAt: timestamp("eliminated_at", { withTimezone: true }),
  },
  (table) => [
    index("rr_players_match_id_idx").on(table.matchId),
    index("rr_players_user_id_idx").on(table.userId),
    uniqueIndex("rr_players_match_user_idx").on(table.matchId, table.userId),
  ],
);

export type RRPlayer = typeof rrPlayers.$inferSelect;
export type NewRRPlayer = typeof rrPlayers.$inferInsert;

export const rrLootDrops = pgTable(
  "rr_loot_drops",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    matchId: uuid("match_id")
      .notNull()
      .references(() => rrMatches.id, { onDelete: "cascade" }),
    claimedByUserId: text("claimed_by_user_id").references(
      () => authUsers.id,
      { onDelete: "set null" },
    ),
    objectName: varchar("object_name", { length: 255 }).notNull(),
    lootType: varchar("loot_type", { length: 20 })
      .notNull()
      .$type<"weapon" | "shield" | "health" | "special">(),
    rarity: varchar("rarity", { length: 20 })
      .notNull()
      .$type<"common" | "uncommon" | "rare" | "epic" | "legendary">(),
    power: integer("power").notNull(),
    scannedFromObject: varchar("scanned_from_object", { length: 255 }),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("rr_loot_drops_match_id_idx").on(table.matchId),
    index("rr_loot_drops_claimed_idx").on(table.claimedByUserId),
  ],
);

export type RRLootDrop = typeof rrLootDrops.$inferSelect;
export type NewRRLootDrop = typeof rrLootDrops.$inferInsert;

export const rrCombatLog = pgTable(
  "rr_combat_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    matchId: uuid("match_id")
      .notNull()
      .references(() => rrMatches.id, { onDelete: "cascade" }),
    attackerId: text("attacker_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    defenderId: text("defender_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    weaponUsed: varchar("weapon_used", { length: 255 }).notNull(),
    damage: integer("damage").notNull(),
    isKill: boolean("is_kill").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("rr_combat_log_match_id_idx").on(table.matchId)],
);

export type RRCombatLogEntry = typeof rrCombatLog.$inferSelect;
export type NewRRCombatLogEntry = typeof rrCombatLog.$inferInsert;
