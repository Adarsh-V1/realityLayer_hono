import { GoogleGenerativeAI, type Part } from "@google/generative-ai";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";
import { groqGenerateVision, isGroqAvailable } from "./groq-fallback.js";

if (!env.GEMINI_API_KEY && !env.GROQ_API_KEY) {
  logger.warn("Neither GEMINI_API_KEY nor GROQ_API_KEY set — AI analysis will fail");
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
 * Analyze an image using Gemini's vision model.
 * Accepts either a publicly-accessible URL or raw base64 data.
 */
export async function analyzeImage(
  imageInput: { url: string } | { base64: string; mimeType: string },
): Promise<AnalysisResult> {
  // Extract image data upfront (needed for both Gemini and fallback)
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

  const imagePart: Part = {
    inlineData: { data: imageBase64, mimeType: imageMimeType },
  };

  // Try Gemini first, then fall back to Groq
  let text: string;

  if (env.GEMINI_API_KEY) {
    try {
      logger.debug("Sending image to Gemini for analysis");
      const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
      const result = await model.generateContent([VISION_PROMPT, imagePart]);
      text = result.response.text();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn({ err: message }, "Gemini API failed, attempting Groq fallback");

      if (!isGroqAvailable()) {
        if (message.includes("429") || message.includes("quota") || message.includes("RESOURCE_EXHAUSTED")) {
          throw new Error("AI service is temporarily unavailable due to rate limits. Please try again in a minute.");
        }
        throw new Error("AI analysis failed. Please try again.");
      }

      text = await groqGenerateVision(VISION_PROMPT, imageBase64, imageMimeType);
      logger.info("Groq fallback succeeded for image analysis");
    }
  } else if (isGroqAvailable()) {
    logger.debug("GEMINI_API_KEY not set, using Groq for image analysis");
    text = await groqGenerateVision(VISION_PROMPT, imageBase64, imageMimeType);
  } else {
    throw new Error("No AI provider configured. Set GEMINI_API_KEY or GROQ_API_KEY.");
  }

  logger.debug({ rawResponse: text.slice(0, 200) }, "AI raw response");
  return parseGeminiResponse(text);
}

// ---------- Helpers ----------

function parseGeminiResponse(raw: string): AnalysisResult {
  // Strip markdown code fences if present
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  }

  try {
    const parsed = JSON.parse(cleaned);

    // Validate structure
    if (!parsed.objects || !Array.isArray(parsed.objects)) {
      logger.warn({ parsed }, "Gemini response missing objects array");
      return { objects: [] };
    }

    // Normalize each object
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
    logger.error({ err, raw: raw.slice(0, 500) }, "Failed to parse Gemini response");
    throw new Error("AI returned an invalid response. Please try again.");
  }
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, isNaN(v) ? 0 : v));
}
