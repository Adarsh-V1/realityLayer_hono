import { relations } from "drizzle-orm";
import { authUsers, session, account } from "./auth.js";
import { userProfiles } from "./users.js";
import { scans, scanResults } from "./scans.js";
import { plugins, userPlugins } from "./plugins.js";
import { memories } from "./memories.js";
import { subscriptions, apiKeys, usageRecords, auditLogs } from "./saas.js";

// --- Auth user relations ---
export const authUsersRelations = relations(authUsers, ({ one, many }) => ({
  profile: one(userProfiles, {
    fields: [authUsers.id],
    references: [userProfiles.userId],
  }),
  sessions: many(session),
  accounts: many(account),
  scans: many(scans),
  userPlugins: many(userPlugins),
  memories: many(memories),
  subscription: one(subscriptions, {
    fields: [authUsers.id],
    references: [subscriptions.userId],
  }),
  apiKeys: many(apiKeys),
  usageRecords: many(usageRecords),
  auditLogs: many(auditLogs),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(authUsers, {
    fields: [session.userId],
    references: [authUsers.id],
  }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(authUsers, {
    fields: [account.userId],
    references: [authUsers.id],
  }),
}));

// --- Profile relations ---
export const userProfilesRelations = relations(userProfiles, ({ one }) => ({
  user: one(authUsers, {
    fields: [userProfiles.userId],
    references: [authUsers.id],
  }),
}));

// --- Scan relations ---
export const scansRelations = relations(scans, ({ one, many }) => ({
  user: one(authUsers, {
    fields: [scans.userId],
    references: [authUsers.id],
  }),
  results: many(scanResults),
  memories: many(memories),
}));

export const scanResultsRelations = relations(scanResults, ({ one }) => ({
  scan: one(scans, {
    fields: [scanResults.scanId],
    references: [scans.id],
  }),
}));

// --- Plugin relations ---
export const pluginsRelations = relations(plugins, ({ many }) => ({
  userPlugins: many(userPlugins),
}));

export const userPluginsRelations = relations(userPlugins, ({ one }) => ({
  user: one(authUsers, {
    fields: [userPlugins.userId],
    references: [authUsers.id],
  }),
  plugin: one(plugins, {
    fields: [userPlugins.pluginId],
    references: [plugins.id],
  }),
}));

// --- Memory relations ---
export const memoriesRelations = relations(memories, ({ one }) => ({
  user: one(authUsers, {
    fields: [memories.userId],
    references: [authUsers.id],
  }),
  scan: one(scans, {
    fields: [memories.scanId],
    references: [scans.id],
  }),
}));

// --- SaaS relations ---
export const subscriptionsRelations = relations(subscriptions, ({ one }) => ({
  user: one(authUsers, {
    fields: [subscriptions.userId],
    references: [authUsers.id],
  }),
}));

export const apiKeysRelations = relations(apiKeys, ({ one }) => ({
  user: one(authUsers, {
    fields: [apiKeys.userId],
    references: [authUsers.id],
  }),
}));

export const usageRecordsRelations = relations(usageRecords, ({ one }) => ({
  user: one(authUsers, {
    fields: [usageRecords.userId],
    references: [authUsers.id],
  }),
}));

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  user: one(authUsers, {
    fields: [auditLogs.userId],
    references: [authUsers.id],
  }),
}));

