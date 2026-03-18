import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { AuthedEnv } from "../lib/types.js";
import { requireAuth } from "../middleware/auth-guard.js";
import { success, error } from "../lib/api-response.js";
import { logger } from "../lib/logger.js";
import { db } from "../db/connection.js";
import { subscriptions } from "../db/schema/saas.js";
import { PLANS, getPlan } from "../lib/plans.js";
import {
  createStripeCustomer,
  createCheckoutSession,
  createPortalSession,
  constructWebhookEvent,
} from "../lib/stripe.js";
import type { SubscriptionTier } from "../db/schema/saas.js";

export const subscriptionRoute = new Hono<AuthedEnv>();

// All subscription routes require auth (except webhook)
subscriptionRoute.use("/subscription/*", requireAuth);

/**
 * GET /api/subscription
 * Returns the user's current subscription with plan details.
 */
subscriptionRoute.get("/subscription", async (c) => {
  const user = c.get("user");

  let [sub] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, user.id))
    .limit(1);

  // Auto-create free subscription if none exists
  if (!sub) {
    [sub] = await db
      .insert(subscriptions)
      .values({ userId: user.id, tier: "free", status: "active" })
      .returning();
  }

  const plan = getPlan(sub.tier as SubscriptionTier);

  return success(c, {
    subscription: {
      id: sub.id,
      tier: sub.tier,
      status: sub.status,
      currentPeriodStart: sub.currentPeriodStart,
      currentPeriodEnd: sub.currentPeriodEnd,
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
    },
    plan: {
      name: plan.name,
      description: plan.description,
      priceMonthly: plan.priceMonthly,
      limits: plan.limits,
    },
  });
});

/**
 * GET /api/subscription/plans
 * Lists all available subscription plans.
 */
subscriptionRoute.get("/subscription/plans", async (c) => {
  const plans = Object.values(PLANS).map((p) => ({
    tier: p.tier,
    name: p.name,
    description: p.description,
    priceMonthly: p.priceMonthly,
    limits: p.limits,
  }));

  return success(c, { plans });
});

/**
 * POST /api/subscription/checkout
 * Creates a Stripe Checkout session for upgrading.
 */
subscriptionRoute.post("/subscription/checkout", async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{ tier: string; successUrl: string; cancelUrl: string }>();

  const targetTier = body.tier as SubscriptionTier;
  if (!PLANS[targetTier] || targetTier === "free") {
    return error(c, "INVALID_PLAN", "Invalid or non-billable plan", 400);
  }

  const plan = getPlan(targetTier);
  if (!plan.stripePriceId) {
    return error(c, "PLAN_NOT_CONFIGURED", "Stripe price ID not configured for this plan", 400);
  }

  // Ensure user has a subscription record with Stripe customer
  let [sub] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, user.id))
    .limit(1);

  if (!sub) {
    const customerId = await createStripeCustomer(user.email, user.name, user.id);
    [sub] = await db
      .insert(subscriptions)
      .values({
        userId: user.id,
        tier: "free",
        status: "active",
        stripeCustomerId: customerId,
      })
      .returning();
  } else if (!sub.stripeCustomerId) {
    const customerId = await createStripeCustomer(user.email, user.name, user.id);
    if (customerId) {
      await db
        .update(subscriptions)
        .set({ stripeCustomerId: customerId })
        .where(eq(subscriptions.id, sub.id));
      sub.stripeCustomerId = customerId;
    }
  }

  if (!sub.stripeCustomerId) {
    return error(c, "STRIPE_NOT_CONFIGURED", "Stripe billing is not available", 400);
  }

  const checkoutUrl = await createCheckoutSession({
    customerId: sub.stripeCustomerId,
    priceId: plan.stripePriceId,
    successUrl: body.successUrl,
    cancelUrl: body.cancelUrl,
  });

  return success(c, { url: checkoutUrl });
});

/**
 * POST /api/subscription/portal
 * Creates a Stripe billing portal session for self-serve management.
 */
subscriptionRoute.post("/subscription/portal", async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{ returnUrl: string }>();

  const [sub] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, user.id))
    .limit(1);

  if (!sub?.stripeCustomerId) {
    return error(c, "NO_SUBSCRIPTION", "No active billing subscription found", 400);
  }

  const portalUrl = await createPortalSession(sub.stripeCustomerId, body.returnUrl);
  return success(c, { url: portalUrl });
});

// ---------------------------------------------------------------------------
// Stripe webhook (unauthenticated — verified by signature)
// ---------------------------------------------------------------------------

export const stripeWebhookRoute = new Hono();

stripeWebhookRoute.post("/webhooks/stripe", async (c) => {
  const signature = c.req.header("stripe-signature");
  if (!signature) {
    return c.json({ error: "Missing stripe-signature header" }, 400);
  }

  const body = await c.req.text();

  let event;
  try {
    event = constructWebhookEvent(body, signature);
  } catch (err) {
    logger.error({ err }, "Stripe webhook signature verification failed");
    return c.json({ error: "Invalid signature" }, 400);
  }

  logger.info({ type: event.type, id: event.id }, "Stripe webhook received");

  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const subscription = event.data.object as {
        id: string;
        customer: string;
        status: string;
        items: { data: Array<{ price: { id: string; metadata?: Record<string, string> } }> };
        current_period_start: number;
        current_period_end: number;
        cancel_at_period_end: boolean;
      };

      // Determine tier from price metadata or price ID
      const priceId = subscription.items.data[0]?.price.id;
      let tier: SubscriptionTier = "free";
      for (const [t, plan] of Object.entries(PLANS)) {
        if (plan.stripePriceId === priceId) {
          tier = t as SubscriptionTier;
          break;
        }
      }

      await db
        .update(subscriptions)
        .set({
          tier,
          status: subscription.status as "active" | "past_due" | "canceled" | "trialing" | "unpaid",
          stripeSubscriptionId: subscription.id,
          stripePriceId: priceId,
          currentPeriodStart: new Date(subscription.current_period_start * 1000),
          currentPeriodEnd: new Date(subscription.current_period_end * 1000),
          cancelAtPeriodEnd: subscription.cancel_at_period_end,
        })
        .where(eq(subscriptions.stripeCustomerId, subscription.customer as string));

      logger.info({ tier, status: subscription.status }, "Subscription updated via webhook");
      break;
    }

    case "customer.subscription.deleted": {
      const subscription = event.data.object as { customer: string };

      await db
        .update(subscriptions)
        .set({ tier: "free", status: "canceled", stripeSubscriptionId: null, stripePriceId: null })
        .where(eq(subscriptions.stripeCustomerId, subscription.customer as string));

      logger.info("Subscription canceled via webhook — reverted to free tier");
      break;
    }

    default:
      logger.debug({ type: event.type }, "Unhandled Stripe webhook event");
  }

  return c.json({ received: true });
});
