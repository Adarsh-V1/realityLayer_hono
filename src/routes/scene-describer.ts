import { Hono } from "hono";
import { z } from "zod";
import { GoogleGenerativeAI } from "@google/generative-ai";
import type { AuthedEnv } from "../lib/types.js";
import { requireAuth } from "../middleware/auth-guard.js";
import { success, error } from "../lib/api-response.js";
import { env } from "../config/env.js";
import { parseAIJson } from "../plugins/ai-helper.js";

export const sceneDescriberRoute = new Hono<AuthedEnv>();

sceneDescriberRoute.use("/*", requireAuth);

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const describeSceneSchema = z.object({
  image: z.string().min(1, "image is required"),
});

// Max 10 MB base64 payload
const MAX_BASE64_LENGTH = 10 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Scene description prompt — optimized for accessibility / visually impaired
// ---------------------------------------------------------------------------

const SCENE_PROMPT = `You are an expert scene describer for visually impaired users.
Analyze the provided image and produce a detailed, natural-language description of the entire scene.

Your description should be:
- Vivid and spatial: describe where objects are relative to each other (left, right, foreground, background)
- Practical: mention anything a visually impaired person would need to know (obstacles, steps, distances)
- Complete: describe lighting, colors, textures, and mood of the scene

Return a JSON object with:
- "description": a detailed 3-5 sentence natural language description of the full scene
- "objects": an array of objects, each with:
  - "name": what the object is
  - "position": where it is in the scene (e.g. "center foreground", "top left", "right side")
- "mood": a short phrase describing the overall mood/atmosphere (e.g. "calm and well-lit", "cluttered workspace", "dark outdoor path")

Return ONLY valid JSON. No markdown fences, no commentary.`;

// ---------------------------------------------------------------------------
// POST /describe-scene — Describe a scene for accessibility
// ---------------------------------------------------------------------------

sceneDescriberRoute.post("/describe-scene", async (c) => {
  const body = await c.req.json();

  const parsed = describeSceneSchema.safeParse(body);
  if (!parsed.success) {
    return error(c, "INVALID_INPUT", parsed.error.issues[0].message, 400);
  }

  let { image } = parsed.data;
  let mimeType = "image/jpeg";

  // Strip data-URI prefix if present
  const dataUriMatch = image.match(/^data:(image\/[^;]+);base64,(.+)$/);
  if (dataUriMatch) {
    mimeType = dataUriMatch[1];
    image = dataUriMatch[2];
  }

  // Clean up whitespace
  const base64Clean = image.replace(/\s/g, "");

  // Validate base64 format
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64Clean)) {
    return error(c, "INVALID_INPUT", "Image data is not valid base64", 400);
  }

  if (base64Clean.length > MAX_BASE64_LENGTH) {
    return error(c, "PAYLOAD_TOO_LARGE", "Image must be under 10 MB", 413);
  }

  if (!env.GEMINI_API_KEY) {
    return error(
      c,
      "SERVICE_UNAVAILABLE",
      "Scene description requires Gemini API key to be configured",
      503,
    );
  }

  const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    generationConfig: { responseMimeType: "application/json" },
  });

  const result = await model.generateContent([
    SCENE_PROMPT,
    {
      inlineData: {
        data: base64Clean,
        mimeType,
      },
    },
  ]);

  const rawText = result.response.text();

  const sceneResult = parseAIJson<{
    description: string;
    objects: { name: string; position: string }[];
    mood: string;
  }>(rawText);

  return success(c, sceneResult);
});
