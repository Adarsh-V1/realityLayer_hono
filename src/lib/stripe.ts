import Stripe from "stripe";
import { env } from "../config/env.js";

let _stripe: Stripe | null = null;

/**
 * Lazily-initialized Stripe client.
 * Returns null if STRIPE_SECRET_KEY is not configured (free-tier-only mode).
 */
export function getStripe(): Stripe | null {
  if (!env.STRIPE_SECRET_KEY) return null;
  if (!_stripe) {
    _stripe = new Stripe(env.STRIPE_SECRET_KEY, {
      apiVersion: "2025-02-24.acacia",
      typescript: true,
    });
  }
  return _stripe;
}

/**
 * Create a Stripe customer for a new user.
 */
export async function createStripeCustomer(
  email: string,
  name: string,
  userId: string,
): Promise<string | null> {
  const stripe = getStripe();
  if (!stripe) return null;

  const customer = await stripe.customers.create({
    email,
    name,
    metadata: { userId },
  });

  return customer.id;
}

/**
 * Create a Stripe Checkout session for plan upgrade.
 */
export async function createCheckoutSession(opts: {
  customerId: string;
  priceId: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<string> {
  const stripe = getStripe();
  if (!stripe) throw new Error("Stripe is not configured");

  const session = await stripe.checkout.sessions.create({
    customer: opts.customerId,
    mode: "subscription",
    line_items: [{ price: opts.priceId, quantity: 1 }],
    success_url: opts.successUrl,
    cancel_url: opts.cancelUrl,
    subscription_data: {
      metadata: { customerId: opts.customerId },
    },
  });

  return session.url!;
}

/**
 * Create a Stripe billing portal session for self-serve management.
 */
export async function createPortalSession(
  customerId: string,
  returnUrl: string,
): Promise<string> {
  const stripe = getStripe();
  if (!stripe) throw new Error("Stripe is not configured");

  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  });

  return session.url;
}

/**
 * Verify and parse a Stripe webhook event.
 */
export function constructWebhookEvent(
  body: string,
  signature: string,
): Stripe.Event {
  const stripe = getStripe();
  if (!stripe) throw new Error("Stripe is not configured");
  if (!env.STRIPE_WEBHOOK_SECRET) {
    throw new Error("STRIPE_WEBHOOK_SECRET is not configured");
  }

  return stripe.webhooks.constructEvent(
    body,
    signature,
    env.STRIPE_WEBHOOK_SECRET,
  );
}
