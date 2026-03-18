import { GoogleGenerativeAI } from "@google/generative-ai";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";

if (!env.GEMINI_API_KEY) {
  logger.warn("GEMINI_API_KEY not set — audio transcription unavailable");
}

const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY ?? "");

export interface TranscriptionResult {
  text: string;
  language: string | null;
  durationMs: number;
}

const TRANSCRIPTION_PROMPT = `Transcribe the following audio exactly as spoken.
Return ONLY a JSON object with these fields:
- "text": the transcribed speech (verbatim, no corrections)
- "language": the ISO 639-1 language code (e.g. "en", "es", "fr")

If the audio is silent or unintelligible, return: { "text": "", "language": null }
No markdown fences, no commentary — raw JSON only.`;

/**
 * Transcribe audio using Gemini 2.0 Flash (native audio understanding).
 * Accepts base64-encoded audio data.
 */
export async function transcribeAudio(
  audioBase64: string,
  mimeType: string = "audio/m4a",
): Promise<TranscriptionResult> {
  if (!env.GEMINI_API_KEY) {
    throw new Error("Transcription is not configured — set GEMINI_API_KEY");
  }

  const start = Date.now();

  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

  logger.debug(
    { size: audioBase64.length, mimeType },
    "Sending audio to Gemini for transcription",
  );

  const result = await model.generateContent([
    TRANSCRIPTION_PROMPT,
    {
      inlineData: {
        data: audioBase64,
        mimeType,
      },
    },
  ]);

  const raw = result.response.text().trim();
  const durationMs = Date.now() - start;

  // Parse the JSON response
  let text = "";
  let language: string | null = null;

  try {
    let cleaned = raw;
    if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
    }
    const parsed = JSON.parse(cleaned);
    text = String(parsed.text ?? "");
    language = parsed.language ?? null;
  } catch {
    // If JSON parsing fails, treat the raw response as the transcript
    text = raw;
    logger.warn(
      { raw: raw.slice(0, 200) },
      "Gemini transcription response was not valid JSON, using raw text",
    );
  }

  logger.info(
    {
      transcriptionLength: text.length,
      language,
      durationMs,
    },
    "Gemini transcription complete",
  );

  return { text, language, durationMs };
}
