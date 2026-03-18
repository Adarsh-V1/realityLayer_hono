import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../lib/types.js";
import { success, error } from "../lib/api-response.js";
import { pluginRegistry } from "../plugins/index.js";

export const pluginRoute = new Hono<AppEnv>();

// ---------------------------------------------------------------------------
// GET /api/plugins — list all available plugins
// ---------------------------------------------------------------------------
pluginRoute.get("/plugins", (c) => {
  const plugins = pluginRegistry.listAll();
  return success(c, { plugins });
});

// ---------------------------------------------------------------------------
// GET /api/plugins/:slug — get a single plugin's details
// ---------------------------------------------------------------------------
pluginRoute.get("/plugins/:slug", (c) => {
  const slug = c.req.param("slug");
  const handler = pluginRegistry.get(slug);

  if (!handler) {
    return error(c, "PLUGIN_NOT_FOUND", `Plugin "${slug}" not found`, 404);
  }

  return success(c, {
    slug: handler.slug,
    name: handler.name,
    description: handler.description,
    version: handler.version,
    icon: handler.icon,
    configSchema: handler.configSchema,
  });
});

// ---------------------------------------------------------------------------
// POST /api/plugins/:slug/execute — run a plugin against provided objects
//
// Body: { objects: ObjectInsight[], imageBase64?: string }
//
// This is a standalone execution endpoint for testing or manual invocation.
// During normal scans, plugins run inside the /api/scan pipeline.
// ---------------------------------------------------------------------------
const executeBodySchema = z.object({
  objects: z.array(
    z.object({
      name: z.string(),
      confidence: z.number(),
      boundingBox: z.object({
        x: z.number(),
        y: z.number(),
        width: z.number(),
        height: z.number(),
      }),
      insights: z.object({
        summary: z.string(),
        recommendation: z.string(),
        price: z.string(),
      }),
    }),
  ),
  imageBase64: z.string().optional().default(""),
  config: z.record(z.string(), z.unknown()).optional().default({}),
});

pluginRoute.post("/plugins/:slug/execute", async (c) => {
  const slug = c.req.param("slug");
  const handler = pluginRegistry.get(slug);

  if (!handler) {
    return error(c, "PLUGIN_NOT_FOUND", `Plugin "${slug}" not found`, 404);
  }

  const body = await c.req.json();
  const parsed = executeBodySchema.safeParse(body);

  if (!parsed.success) {
    return error(c, "INVALID_INPUT", parsed.error.issues[0].message, 400);
  }

  const results = await pluginRegistry.execute(
    [slug],
    {
      objects: parsed.data.objects,
      imageBase64: parsed.data.imageBase64,
      imageMimeType: "image/jpeg",
    },
    { [slug]: parsed.data.config },
  );

  return success(c, { result: results[0] ?? null });
});
