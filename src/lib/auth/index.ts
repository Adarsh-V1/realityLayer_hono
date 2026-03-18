import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "../../db/connection.js";
import { env } from "../../config/env.js";
import { logger } from "../logger.js";
import {
  authUsers,
  session,
  account,
  verification,
} from "../../db/schema/auth.js";

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: authUsers,
      session,
      account,
      verification,
    },
  }),

  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,

  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
  },

  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // refresh session if older than 1 day
    cookieCache: {
      enabled: true,
      maxAge: 60 * 5, // cache cookie for 5 minutes (reduces DB lookups)
    },
  },

  user: {
    additionalFields: {},
  },

  logger: {
    level: env.NODE_ENV === "development" ? "debug" : "error",
    log(level, message, ...args) {
      const logFn =
        level === "error"
          ? logger.error
          : level === "warn"
            ? logger.warn
            : logger.debug;
      logFn.call(logger, { args }, `[auth] ${message}`);
    },
  },
});

export type Auth = typeof auth;
