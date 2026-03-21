import { GoogleGenerativeAI, type Part } from "@google/generative-ai";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";
import { groqGenerateVision, isGroqAvailable } from "./groq-fallback.js";
import { xaiGenerateVision, isXaiAvailable } from "./xai.js";

if (!env.GEMINI_API_KEY && !env.GROQ_API_KEY && !env.XAI_API_KEY) {
  logger.warn("No AI provider configured (GEMINI_API_KEY, GROQ_API_KEY, XAI_API_KEY) — AI analysis will fail");
}

const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY ?? "");

// ---------- Types ----------

export interface BoundingBox {
  /** Normalized 0-1 coordinates relative to image dimensions */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ObjectInsight {
  name: string;
  confidence: number;
  boundingBox: BoundingBox;
  insights: {
    summary: string;
    recommendation: string;
    price: string;
  };
}

export interface AnalysisResult {
  objects: ObjectInsight[];
}

// ---------- Prompts ----------

const VISION_PROMPT = `You are an expert object-recognition and product-analysis AI.

Analyze the provided image and identify every distinct object you can see.

For EACH object return a JSON object with:
- "name": a concise, specific label (e.g. "MacBook Pro 14-inch" not just "laptop")
- "confidence": your confidence score from 0.0 to 1.0
- "boundingBox": an object with NORMALIZED coordinates (0.0 to 1.0 relative to image width/height):
  - "x": left edge as fraction of image width
  - "y": top edge as fraction of image height
  - "width": box width as fraction of image width
  - "height": box height as fraction of image height
- "insights":
  - "summary": a 1-2 sentence description of the object, its condition, and notable features
  - "recommendation": a practical, actionable suggestion (e.g. repair, upgrade, keep, sell, recycle)
  - "price": estimated current market value as a string (e.g. "$1,200 - $1,500" or "N/A" if not applicable)

Rules:
- Return ONLY a JSON object matching this schema: { "objects": [ ... ] }
- No markdown fences, no commentary — raw JSON only.
- Sort objects by confidence descending.
- Bounding boxes MUST use normalized 0-1 values, NOT pixel values.
- If no objects are recognizable, return { "objects": [] }.`;

// ---------- Public API ----------

/**
 * Analyze an image using available AI providers.
 * Fallback chain: Gemini → Groq → xAI Grok
 */
export async function analyzeImage(
  imageInput: { url: string } | { base64: string; mimeType: string },
): Promise<AnalysisResult> {
  // Extract image data upfront (needed for all providers)
  let imageBase64: string;
  let imageMimeType: string;

  if ("url" in imageInput) {
    const res = await fetch(imageInput.url);
    if (!res.ok) {
      throw new Error(`Failed to fetch image from URL: ${res.status}`);
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    imageMimeType = res.headers.get("content-type") ?? "image/jpeg";
    imageBase64 = buffer.toString("base64");
  } else {
    imageBase64 = imageInput.base64;
    imageMimeType = imageInput.mimeType;
  }

  // Try each provider in order
  const errors: string[] = [];
  let text: string | undefined;

  // 1. Try Gemini
  if (env.GEMINI_API_KEY) {
    try {
      logger.debug("Sending image to Gemini for analysis");
      const imagePart: Part = {
        inlineData: { data: imageBase64, mimeType: imageMimeType },
      };
      const model = genAI.getGenerativeModel({
        model: "gemini-2.5-flash",
        generationConfig: { responseMimeType: "application/json" },
      });
      const result = await model.generateContent([VISION_PROMPT, imagePart]);
      text = result.response.text();
      logger.info("Gemini analysis succeeded");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`Gemini: ${message.slice(0, 100)}`);
      logger.warn({ err: message }, "Gemini failed");
    }
  }

  // 2. Try Groq
  if (!text && isGroqAvailable()) {
    try {
      logger.debug("Trying Groq for image analysis");
      text = await groqGenerateVision(VISION_PROMPT, imageBase64, imageMimeType);
      logger.info("Groq analysis succeeded");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`Groq: ${message.slice(0, 100)}`);
      logger.warn({ err: message }, "Groq failed");
    }
  }

  // 3. Try xAI Grok
  if (!text && isXaiAvailable()) {
    try {
      logger.debug("Trying xAI Grok for image analysis");
      text = await xaiGenerateVision(VISION_PROMPT, imageBase64, imageMimeType);
      logger.info("xAI Grok analysis succeeded");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`xAI: ${message.slice(0, 100)}`);
      logger.warn({ err: message }, "xAI Grok failed");
    }
  }

  // All providers failed
  if (!text) {
    const hasAnyKey = env.GEMINI_API_KEY || env.GROQ_API_KEY || env.XAI_API_KEY;
    if (!hasAnyKey) {
      throw new Error("No AI provider configured. Set GEMINI_API_KEY, GROQ_API_KEY, or XAI_API_KEY.");
    }
    throw new Error(`All AI providers failed: ${errors.join(" | ")}`);
  }

  logger.debug({ rawResponse: text.slice(0, 200) }, "AI raw response");
  return parseVisionResponse(text);
}

// ---------- Helpers ----------

function parseVisionResponse(raw: string): AnalysisResult {
  let cleaned = raw.trim();

  // Extract from markdown fences if present anywhere
  const fencedMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch) {
    cleaned = fencedMatch[1].trim();
  }

  // Strip leading/trailing fences
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  }

  // Extract JSON from prose
  if (!cleaned.startsWith("{") && !cleaned.startsWith("[")) {
    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      cleaned = cleaned.slice(firstBrace, lastBrace + 1);
    }
  }

  try {
    const parsed = JSON.parse(cleaned);

    if (!parsed.objects || !Array.isArray(parsed.objects)) {
      logger.warn({ parsed }, "AI response missing objects array");
      return { objects: [] };
    }

    const objects: ObjectInsight[] = parsed.objects.map((obj: Record<string, unknown>) => {
      const bb = (obj.boundingBox ?? obj.bounding_box ?? {}) as Record<string, unknown>;
      return {
        name: String(obj.name ?? "Unknown"),
        confidence: Math.min(1, Math.max(0, Number(obj.confidence ?? 0))),
        boundingBox: {
          x: clamp01(Number(bb.x ?? 0)),
          y: clamp01(Number(bb.y ?? 0)),
          width: clamp01(Number(bb.width ?? 1)),
          height: clamp01(Number(bb.height ?? 1)),
        },
        insights: {
          summary: String((obj.insights as Record<string, unknown>)?.summary ?? ""),
          recommendation: String((obj.insights as Record<string, unknown>)?.recommendation ?? ""),
          price: String((obj.insights as Record<string, unknown>)?.price ?? "N/A"),
        },
      };
    });

    return { objects };
  } catch (err) {
    logger.error({ err, raw: raw.slice(0, 500) }, "Failed to parse AI response");
    throw new Error("AI returned an invalid response. Please try again.");
  }
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, isNaN(v) ? 0 : v));
}
