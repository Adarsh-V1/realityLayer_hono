import type { Hono } from "hono";
import type { auth } from "./auth/index.js";
import type { SubscriptionTier } from "../db/schema/saas.js";

type SessionUser = typeof auth.$Infer.Session.user;
type SessionData = typeof auth.$Infer.Session.session;

export type AppEnv = {
  Variables: {
    requestId: string;
    user: SessionUser | null;
    session: SessionData | null;
    subscriptionTier: SubscriptionTier;
    apiKeyId: string | null;
    apiKeyScopes: string[];
  };
};

export type AuthedEnv = {
  Variables: {
    requestId: string;
    user: SessionUser;
    session: SessionData;
    subscriptionTier: SubscriptionTier;
    apiKeyId: string | null;
    apiKeyScopes: string[];
  };
};

export type App = Hono<AppEnv>;
