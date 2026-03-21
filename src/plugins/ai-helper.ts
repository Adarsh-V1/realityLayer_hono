import { GoogleGenerativeAI } from "@google/generative-ai";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";
import { groqGenerateText, isGroqAvailable } from "../services/groq-fallback.js";
import { xaiGenerateText, isXaiAvailable } from "../services/xai.js";

const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY ?? "");

/**
 * Generate text from a prompt.
 * Fallback chain: Gemini → Groq → xAI Grok
 */
export async function generateText(prompt: string): Promise<string> {
  const errors: string[] = [];

  // 1. Try Gemini
  if (env.GEMINI_API_KEY) {
    try {
      const model = genAI.getGenerativeModel({
        model: "gemini-2.5-flash",
        generationConfig: { responseMimeType: "application/json" },
      });
      const result = await model.generateContent(prompt);
      return result.response.text();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`Gemini: ${message.slice(0, 100)}`);
      logger.warn({ err: message }, "Gemini failed");
    }
  }

  // 2. Try Groq
  if (isGroqAvailable()) {
    try {
      return await groqGenerateText(prompt, { jsonMode: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`Groq: ${message.slice(0, 100)}`);
      logger.warn({ err: message }, "Groq failed");
    }
  }

  // 3. Try xAI
  if (isXaiAvailable()) {
    try {
      return await xaiGenerateText(prompt, { jsonMode: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`xAI: ${message.slice(0, 100)}`);
      logger.warn({ err: message }, "xAI failed");
    }
  }

  throw new Error(
    errors.length > 0
      ? `All AI providers failed: ${errors.join(" | ")}`
      : "No AI provider configured",
  );
}

/**
 * Parse a JSON response from an AI model, handling common issues:
 * - Markdown code fences
 * - Leading prose text ("Here's the analysis...")
 * - Trailing text after the JSON
 */
export function parseAIJson<T = Record<string, unknown>>(raw: string): T {
  let cleaned = raw.trim();

  // Extract from markdown fences if present anywhere in the response
  const fencedMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch) {
    cleaned = fencedMatch[1].trim();
  }

  // Strip leading/trailing fences if the whole thing is wrapped
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  }

  // If it doesn't start with { or [, extract JSON object
  if (!cleaned.startsWith("{") && !cleaned.startsWith("[")) {
    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      cleaned = cleaned.slice(firstBrace, lastBrace + 1);
    }
  }

  return JSON.parse(cleaned);
}

/**
 * Generate text and parse as JSON in one step.
 */
export async function generateJson<T = Record<string, unknown>>(prompt: string): Promise<T> {
  const text = await generateText(prompt);
  return parseAIJson<T>(text);
}
