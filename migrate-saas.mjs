import 'dotenv/config';
import { neon } from '@neondatabase/serverless';

const url = process.env.DATABASE_URL.replace(/[&?]channel_binding=[^&]*/g, '');
const sql = neon(url);

console.log("Creating tables...");

await sql`CREATE TABLE IF NOT EXISTS "api_keys" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "name" varchar(100) NOT NULL,
  "key_prefix" varchar(12) NOT NULL,
  "key_hash" text NOT NULL,
  "scopes" jsonb DEFAULT '["scan","voice","plugins","memories"]'::jsonb,
  "last_used_at" timestamp with time zone,
  "expires_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "api_keys_key_hash_unique" UNIQUE("key_hash")
)`;
console.log("OK: api_keys");

await sql`CREATE TABLE IF NOT EXISTS "audit_logs" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text,
  "action" varchar(100) NOT NULL,
  "resource" varchar(100) NOT NULL,
  "resource_id" text,
  "method" varchar(10),
  "path" text,
  "status_code" integer,
  "ip_address" text,
  "user_agent" text,
  "request_id" text,
  "metadata" jsonb,
  "duration_ms" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
)`;
console.log("OK: audit_logs");

await sql`CREATE TABLE IF NOT EXISTS "subscriptions" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "tier" varchar(20) DEFAULT 'free' NOT NULL,
  "status" varchar(20) DEFAULT 'active' NOT NULL,
  "stripe_customer_id" text,
  "stripe_subscription_id" text,
  "stripe_price_id" text,
  "current_period_start" timestamp with time zone,
  "current_period_end" timestamp with time zone,
  "cancel_at_period_end" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "subscriptions_user_id_unique" UNIQUE("user_id")
)`;
console.log("OK: subscriptions");

await sql`CREATE TABLE IF NOT EXISTS "usage_records" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "date" varchar(10) NOT NULL,
  "endpoint" varchar(50) NOT NULL,
  "request_count" integer DEFAULT 0 NOT NULL,
  "estimated_cost_micros" bigint DEFAULT 0 NOT NULL,
  "tokens_used" bigint DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
)`;
console.log("OK: usage_records");

console.log("\nAdding foreign keys...");
const fks = [
  () => sql`ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action`,
  () => sql`ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action`,
  () => sql`ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action`,
  () => sql`ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action`,
];
for (const fn of fks) {
  try { await fn(); console.log("OK"); } catch (e) { console.log("SKIP (exists):", e.message?.slice(0, 80)); }
}

console.log("\nAdding indexes...");
await sql`CREATE INDEX IF NOT EXISTS "api_keys_user_idx" ON "api_keys" USING btree ("user_id")`;
await sql`CREATE INDEX IF NOT EXISTS "api_keys_hash_idx" ON "api_keys" USING btree ("key_hash")`;
await sql`CREATE INDEX IF NOT EXISTS "audit_user_idx" ON "audit_logs" USING btree ("user_id")`;
await sql`CREATE INDEX IF NOT EXISTS "audit_action_idx" ON "audit_logs" USING btree ("action")`;
await sql`CREATE INDEX IF NOT EXISTS "audit_created_idx" ON "audit_logs" USING btree ("created_at")`;
await sql`CREATE INDEX IF NOT EXISTS "subscriptions_stripe_customer_idx" ON "subscriptions" USING btree ("stripe_customer_id")`;
await sql`CREATE INDEX IF NOT EXISTS "subscriptions_stripe_sub_idx" ON "subscriptions" USING btree ("stripe_subscription_id")`;
await sql`CREATE INDEX IF NOT EXISTS "usage_user_date_idx" ON "usage_records" USING btree ("user_id","date")`;
await sql`CREATE INDEX IF NOT EXISTS "usage_user_endpoint_idx" ON "usage_records" USING btree ("user_id","endpoint","date")`;
console.log("OK: all indexes");

console.log("\nMigration complete!");
