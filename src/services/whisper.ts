import { GoogleGenerativeAI } from "@google/generative-ai";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";
import { parseAIJson } from "../plugins/ai-helper.js";
import { groqTranscribeAudio, isGroqAvailable } from "./groq-fallback.js";

if (!env.GEMINI_API_KEY && !env.GROQ_API_KEY) {
  logger.warn("Neither GEMINI_API_KEY nor GROQ_API_KEY set — audio transcription unavailable");
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
  if (!env.GEMINI_API_KEY && !isGroqAvailable()) {
    throw new Error("Transcription is not configured — set GEMINI_API_KEY or GROQ_API_KEY");
  }

  const start = Date.now();

  let text = "";
  let language: string | null = null;

  if (env.GEMINI_API_KEY) {
    try {
      const model = genAI.getGenerativeModel({
        model: "gemini-2.5-flash",
        generationConfig: { responseMimeType: "application/json" },
      });

      logger.debug(
        { size: audioBase64.length, mimeType },
        "Sending audio to Gemini for transcription",
      );

      const result = await model.generateContent([
        TRANSCRIPTION_PROMPT,
        { inlineData: { data: audioBase64, mimeType } },
      ]);

      const raw = result.response.text().trim();

      try {
        const parsed = parseAIJson<{ text?: string; language?: string | null }>(raw);
        text = String(parsed.text ?? "");
        language = parsed.language ?? null;
      } catch {
        text = raw;
        logger.warn(
          { raw: raw.slice(0, 200) },
          "Gemini transcription response was not valid JSON, using raw text",
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn({ err: message }, "Gemini transcription failed, attempting Groq fallback");

      if (!isGroqAvailable()) {
        throw new Error("Audio transcription failed. Please try again.");
      }

      const groqResult = await groqTranscribeAudio(audioBase64, mimeType);
      text = groqResult.text;
      language = groqResult.language;
      logger.info("Groq Whisper fallback succeeded for transcription");
    }
  } else {
    logger.debug("GEMINI_API_KEY not set, using Groq Whisper for transcription");
    const groqResult = await groqTranscribeAudio(audioBase64, mimeType);
    text = groqResult.text;
    language = groqResult.language;
  }

  const durationMs = Date.now() - start;

  logger.info(
    { transcriptionLength: text.length, language, durationMs },
    "Transcription complete",
  );

  return { text, language, durationMs };
}
