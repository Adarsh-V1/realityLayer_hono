import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../lib/types.js";
import { success, error } from "../lib/api-response.js";
import { logger } from "../lib/logger.js";
import { uploadImage } from "../services/cloudinary.js";
import { analyzeImage } from "../services/gemini.js";
import { pluginRegistry } from "../plugins/index.js";

export const scanRoute = new Hono<AppEnv>();

// Max 10 MB base64 payload (~7.5 MB raw image)
const MAX_BASE64_LENGTH = 10 * 1024 * 1024;

const scanBodySchema = z.object({
  image: z.string().min(1, "image is required"),
  plugins: z.array(z.string()).optional().default([]),
  pluginConfigs: z
    .record(z.string(), z.record(z.string(), z.unknown()))
    .optional()
    .default({}),
});

/**
 * POST /api/scan
 *
 * Accepts an image as base64 (with or without data-URI prefix)
 * or as a multipart form upload (field name: "image").
 *
 * Pipeline:
 *   1. Parse & validate image input
 *   2. Upload to Cloudinary (persistent storage + CDN)
 *   3. Send to Gemini Vision for object detection + LLM insights
 *   4. Return structured JSON
 */
scanRoute.post("/scan", async (c) => {
  let base64Data: string;
  let mimeType = "image/jpeg";
  let activePlugins: string[] = [];
  let pluginConfigs: Record<string, Record<string, unknown>> = {};

  const contentType = c.req.header("content-type") ?? "";

  // ---------- Parse input ----------
  if (contentType.includes("multipart/form-data")) {
    const formData = await c.req.formData();
    const file = formData.get("image");

    if (!file || !(file instanceof File)) {
      return error(c, "INVALID_INPUT", "Missing 'image' file in form data", 400);
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    base64Data = buffer.toString("base64");
    mimeType = file.type || "image/jpeg";

    // Plugins from form data (comma-separated string)
    const pluginsField = formData.get("plugins");
    if (typeof pluginsField === "string" && pluginsField) {
      activePlugins = pluginsField.split(",").map((s) => s.trim());
    }
  } else {
    // JSON body with base64 string
    const body = await c.req.json();
    const parsed = scanBodySchema.safeParse(body);

    if (!parsed.success) {
      return error(c, "INVALID_INPUT", parsed.error.issues[0].message, 400);
    }

    let raw = parsed.data.image;

    // Strip data-URI prefix if present
    const dataUriMatch = raw.match(/^data:(image\/[^;]+);base64,(.+)$/);
    if (dataUriMatch) {
      mimeType = dataUriMatch[1];
      raw = dataUriMatch[2];
    }

    // Validate base64 format
    const b64Clean = raw.replace(/\s/g, "");
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b64Clean)) {
      return error(c, "INVALID_INPUT", "Image data is not valid base64", 400);
    }

    base64Data = b64Clean;
    activePlugins = parsed.data.plugins;
    pluginConfigs = parsed.data.pluginConfigs;
  }

  // ---------- Validate size ----------
  if (base64Data.length > MAX_BASE64_LENGTH) {
    return error(c, "PAYLOAD_TOO_LARGE", "Image must be under 10 MB", 413);
  }

  const requestId = c.get("requestId");
  logger.info(
    { requestId, mimeType, size: base64Data.length, plugins: activePlugins },
    "Scan request received",
  );

  // ---------- Pipeline ----------
  // Step 1: Upload to Cloudinary
  const uploadPromise = uploadImage(
    `data:${mimeType};base64,${base64Data}`,
    "scans",
  ).catch((err) => {
    logger.error({ err, requestId }, "Cloudinary upload failed");
    return null;
  });

  // Step 2: Analyze with Gemini Vision (concurrent with upload)
  const analysisPromise = analyzeImage({
    base64: base64Data,
    mimeType,
  });

  const [uploadResult, analysisResult] = await Promise.all([
    uploadPromise,
    analysisPromise,
  ]);

  // Step 3: Run active plugins concurrently (after vision, they need objects)
  let pluginResults: import("../plugins/types.js").PluginResult[] = [];

  if (activePlugins.length > 0) {
    pluginResults = await pluginRegistry.execute(
      activePlugins,
      {
        objects: analysisResult.objects,
        imageBase64: base64Data,
        imageMimeType: mimeType,
      },
      pluginConfigs,
    );

    logger.info(
      { requestId, pluginCount: pluginResults.length },
      "Plugin execution complete",
    );
  }

  logger.info(
    {
      requestId,
      objectCount: analysisResult.objects.length,
      uploaded: !!uploadResult,
      pluginCount: pluginResults.length,
    },
    "Scan analysis complete",
  );

  return success(c, {
    ...analysisResult,
    image: uploadResult
      ? { url: uploadResult.secureUrl, publicId: uploadResult.publicId }
      : null,
    pluginResults,
  });
});
