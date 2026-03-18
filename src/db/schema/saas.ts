import {
  pgTable,
  text,
  varchar,
  timestamp,
  integer,
  boolean,
  jsonb,
  index,
  bigint,
} from "drizzle-orm/pg-core";
import { authUsers } from "./auth.js";

// ---------------------------------------------------------------------------
// Subscription plans & billing
// ---------------------------------------------------------------------------

export type SubscriptionTier = "free" | "pro" | "enterprise";
export type SubscriptionStatus =
  | "active"
  | "past_due"
  | "canceled"
  | "trialing"
  | "unpaid";

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .unique()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    tier: varchar("tier", { length: 20 })
      .notNull()
      .$type<SubscriptionTier>()
      .default("free"),
    status: varchar("status", { length: 20 })
      .notNull()
      .$type<SubscriptionStatus>()
      .default("active"),

    // Stripe references
    stripeCustomerId: text("stripe_customer_id"),
    stripeSubscriptionId: text("stripe_subscription_id"),
    stripePriceId: text("stripe_price_id"),

    // Billing cycle
    currentPeriodStart: timestamp("current_period_start", {
      withTimezone: true,
    }),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("subscriptions_stripe_customer_idx").on(t.stripeCustomerId),
    index("subscriptions_stripe_sub_idx").on(t.stripeSubscriptionId),
  ],
);

export type Subscription = typeof subscriptions.$inferSelect;
export type NewSubscription = typeof subscriptions.$inferInsert;

// ---------------------------------------------------------------------------
// API keys
// ---------------------------------------------------------------------------

export const apiKeys = pgTable(
  "api_keys",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),

    /** Display name chosen by the user */
    name: varchar("name", { length: 100 }).notNull(),

    /**
     * The key prefix shown to the user (e.g. "rl_live_abc1").
     * The full key is only returned once at creation time.
     */
    keyPrefix: varchar("key_prefix", { length: 12 }).notNull(),

    /** SHA-256 hash of the full API key — used for lookup */
    keyHash: text("key_hash").notNull().unique(),

    /** Optional permission scopes */
    scopes: jsonb("scopes").$type<string[]>().default(["scan", "voice", "plugins", "memories"]),

    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("api_keys_user_idx").on(t.userId),
    index("api_keys_hash_idx").on(t.keyHash),
  ],
);

export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;

// ---------------------------------------------------------------------------
// Usage tracking (per-day rollups)
// ---------------------------------------------------------------------------

export const usageRecords = pgTable(
  "usage_records",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),

    /** ISO date string (YYYY-MM-DD) for daily rollup */
    date: varchar("date", { length: 10 }).notNull(),

    /** Endpoint category */
    endpoint: varchar("endpoint", { length: 50 }).notNull(),

    /** Number of requests this day */
    requestCount: integer("request_count").notNull().default(0),

    /** Estimated cost in microdollars (1 microdollar = $0.000001) */
    estimatedCostMicros: bigint("estimated_cost_micros", { mode: "number" })
      .notNull()
      .default(0),

    /** Total tokens consumed (for AI endpoints) */
    tokensUsed: bigint("tokens_used", { mode: "number" }).notNull().default(0),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("usage_user_date_idx").on(t.userId, t.date),
    index("usage_user_endpoint_idx").on(t.userId, t.endpoint, t.date),
  ],
);

export type UsageRecord = typeof usageRecords.$inferSelect;
export type NewUsageRecord = typeof usageRecords.$inferInsert;

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id").references(() => authUsers.id, {
      onDelete: "set null",
    }),

    action: varchar("action", { length: 100 }).notNull(),
    resource: varchar("resource", { length: 100 }).notNull(),
    resourceId: text("resource_id"),

    /** Request metadata */
    method: varchar("method", { length: 10 }),
    path: text("path"),
    statusCode: integer("status_code"),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    requestId: text("request_id"),

    /** Additional context */
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),

    durationMs: integer("duration_ms"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("audit_user_idx").on(t.userId),
    index("audit_action_idx").on(t.action),
    index("audit_created_idx").on(t.createdAt),
  ],
);

export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;
