import { Hono } from "hono";
import type { AppEnv } from "../lib/types.js";
import { success } from "../lib/api-response.js";

export const healthRoute = new Hono<AppEnv>();

healthRoute.get("/health", (c) => {
  return success(c, {
    status: "healthy",
    version: process.env.npm_package_version ?? "0.1.0",
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
  });
});

healthRoute.get("/", (c) => {
  return success(c, {
    name: "Reality Layer API",
    version: process.env.npm_package_version ?? "0.1.0",
  });
});
