import type { SubscriptionTier } from "../db/schema/saas.js";

/**
 * Subscription plan definitions — single source of truth for
 * rate limits, feature gates, and cost budgets per tier.
 */

export interface PlanLimits {
  /** Requests per minute */
  rpm: number;
  /** Requests per day */
  rpd: number;
  /** Max scans per month */
  scansPerMonth: number;
  /** Max voice requests per month */
  voicePerMonth: number;
  /** Max API keys a user can create */
  maxApiKeys: number;
  /** Max image size in bytes */
  maxImageBytes: number;
  /** Whether advanced plugins are available */
  advancedPlugins: boolean;
  /** Monthly cost budget in microdollars (0 = unlimited) */
  monthlyBudgetMicros: number;
  /** Priority in processing queue (lower = higher priority) */
  priority: number;
}

export interface Plan {
  tier: SubscriptionTier;
  name: string;
  description: string;
  /** Monthly price in cents (USD) */
  priceMonthly: number;
  /** Stripe price ID (set via env or Stripe dashboard) */
  stripePriceId: string | null;
  limits: PlanLimits;
}

export const PLANS: Record<SubscriptionTier, Plan> = {
  free: {
    tier: "free",
    name: "Free",
    description: "Get started with basic scanning and voice features",
    priceMonthly: 0,
    stripePriceId: null,
    limits: {
      rpm: 10,
      rpd: 100,
      scansPerMonth: 50,
      voicePerMonth: 30,
      maxApiKeys: 1,
      maxImageBytes: 5 * 1024 * 1024, // 5 MB
      advancedPlugins: false,
      monthlyBudgetMicros: 5_000_000, // $5
      priority: 3,
    },
  },
  pro: {
    tier: "pro",
    name: "Pro",
    description: "For power users who need more scans and advanced features",
    priceMonthly: 1999, // $19.99
    stripePriceId: process.env.STRIPE_PRO_PRICE_ID ?? null,
    limits: {
      rpm: 60,
      rpd: 2_000,
      scansPerMonth: 1_000,
      voicePerMonth: 500,
      maxApiKeys: 5,
      maxImageBytes: 10 * 1024 * 1024, // 10 MB
      advancedPlugins: true,
      monthlyBudgetMicros: 50_000_000, // $50
      priority: 2,
    },
  },
  enterprise: {
    tier: "enterprise",
    name: "Enterprise",
    description: "Unlimited access with dedicated support and SLAs",
    priceMonthly: 9999, // $99.99
    stripePriceId: process.env.STRIPE_ENTERPRISE_PRICE_ID ?? null,
    limits: {
      rpm: 300,
      rpd: 50_000,
      scansPerMonth: 50_000,
      voicePerMonth: 20_000,
      maxApiKeys: 25,
      maxImageBytes: 25 * 1024 * 1024, // 25 MB
      advancedPlugins: true,
      monthlyBudgetMicros: 0, // unlimited
      priority: 1,
    },
  },
};

export function getPlan(tier: SubscriptionTier): Plan {
  return PLANS[tier];
}

export function getPlanLimits(tier: SubscriptionTier): PlanLimits {
  return PLANS[tier].limits;
}
