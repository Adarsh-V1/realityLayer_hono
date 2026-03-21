import { GoogleGenerativeAI } from "@google/generative-ai";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";
import { groqGenerateText, groqGenerateVision, isGroqAvailable } from "./groq-fallback.js";
import { xaiGenerateText, xaiGenerateVision, isXaiAvailable } from "./xai.js";

const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY ?? "");

export interface VoiceContext {
  /** What the user said (transcribed) */
  transcript: string;
  /** Objects detected in the current scan */
  objects?: {
    name: string;
    confidence: number;
    summary: string;
    price: string;
  }[];
  /** The current image as base64 (optional for richer context) */
  imageBase64?: string;
  imageMimeType?: string;
  /** Previous conversation turns for continuity */
  history?: { role: "user" | "assistant"; text: string }[];
}

export interface VoiceResponse {
  reply: string;
  processingTimeMs: number;
}

const SYSTEM_PROMPT = `You are a helpful voice assistant integrated into "Reality Layer", a mobile app that scans real-world objects using the camera.

Your role:
- Answer the user's spoken question about what they're looking at
- Use the detected objects and their details as context
- Be conversational, concise, and helpful — responses will be spoken aloud
- Keep responses to 2-3 sentences max unless the user asks for detail
- If the user asks about price, condition, or recommendations, reference the scan data
- If no objects are detected, acknowledge that and suggest the user scan something first

Tone: Friendly, knowledgeable, direct. Like a helpful shopping companion or knowledgeable friend.`;

/**
 * Generate a conversational AI response using Gemini,
 * combining the user's spoken question with scan context.
 */
export async function generateVoiceResponse(
  ctx: VoiceContext,
): Promise<VoiceResponse> {
  const start = Date.now();
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

  // Build context block
  const contextParts: string[] = [SYSTEM_PROMPT, ""];

  if (ctx.objects && ctx.objects.length > 0) {
    contextParts.push("Currently detected objects in the user's camera view:");
    for (const obj of ctx.objects) {
      contextParts.push(
        `- ${obj.name} (${Math.round(obj.confidence * 100)}% confidence): ${obj.summary} | Price: ${obj.price}`,
      );
    }
    contextParts.push("");
  } else {
    contextParts.push(
      "No objects have been scanned yet. The user hasn't taken a photo.",
      "",
    );
  }

  // Add conversation history
  if (ctx.history && ctx.history.length > 0) {
    contextParts.push("Previous conversation:");
    for (const turn of ctx.history.slice(-6)) {
      const prefix = turn.role === "user" ? "User" : "Assistant";
      contextParts.push(`${prefix}: ${turn.text}`);
    }
    contextParts.push("");
  }

  contextParts.push(`User says: "${ctx.transcript}"`);
  contextParts.push("");
  contextParts.push(
    "Respond naturally as a voice assistant. Keep it short and conversational.",
  );

  const prompt = contextParts.join("\n");

  // If image is available, include it for richer multimodal understanding
  const parts: (string | { inlineData: { data: string; mimeType: string } })[] =
    [prompt];

  if (ctx.imageBase64 && ctx.imageMimeType) {
    parts.push({
      inlineData: {
        data: ctx.imageBase64,
        mimeType: ctx.imageMimeType,
      },
    });
  }

  let reply = "";

  if (env.GEMINI_API_KEY) {
    try {
      logger.debug("Sending voice conversation to Gemini");
      const result = await model.generateContent(parts);
      reply = result.response.text().trim();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn({ err: message }, "Gemini voice failed, attempting Groq fallback");

      // Try Groq fallback
      let groqOk = false;
      if (isGroqAvailable()) {
        try {
          if (ctx.imageBase64 && ctx.imageMimeType) {
            reply = await groqGenerateVision(prompt, ctx.imageBase64, ctx.imageMimeType);
          } else {
            reply = await groqGenerateText(prompt);
          }
          reply = reply.trim();
          groqOk = true;
          logger.info("Groq fallback succeeded for voice response");
        } catch (groqErr) {
          logger.warn({ err: groqErr instanceof Error ? groqErr.message : String(groqErr) }, "Groq voice also failed");
        }
      }

      // Try xAI fallback
      if (!groqOk) {
        if (!isXaiAvailable()) {
          throw new Error("Voice AI is temporarily unavailable. Please try again.");
        }
        if (ctx.imageBase64 && ctx.imageMimeType) {
          reply = await xaiGenerateVision(prompt, ctx.imageBase64, ctx.imageMimeType);
        } else {
          reply = await xaiGenerateText(prompt);
        }
        reply = reply.trim();
        logger.info("xAI fallback succeeded for voice response");
      }
    }
  } else if (isGroqAvailable()) {
    logger.debug("GEMINI_API_KEY not set, using Groq for voice response");
    if (ctx.imageBase64 && ctx.imageMimeType) {
      reply = await groqGenerateVision(prompt, ctx.imageBase64, ctx.imageMimeType);
    } else {
      reply = await groqGenerateText(prompt);
    }
    reply = reply.trim();
  } else if (isXaiAvailable()) {
    logger.debug("Using xAI for voice response");
    if (ctx.imageBase64 && ctx.imageMimeType) {
      reply = await xaiGenerateVision(prompt, ctx.imageBase64, ctx.imageMimeType);
    } else {
      reply = await xaiGenerateText(prompt);
    }
    reply = reply.trim();
  } else {
    throw new Error("No AI provider configured. Set GEMINI_API_KEY, GROQ_API_KEY, or XAI_API_KEY.");
  }

  const processingTimeMs = Date.now() - start;

  logger.info(
    { replyLength: reply.length, processingTimeMs },
    "Voice response generated",
  );

  return { reply, processingTimeMs };
}
