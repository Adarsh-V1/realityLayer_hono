import OpenAI from "openai";
import fs from "fs";
import os from "os";
import path from "path";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";

let groqClient: OpenAI | null = null;

function getGroq(): OpenAI {
  if (!env.GROQ_API_KEY) {
    throw new Error("GROQ_API_KEY not set — Groq fallback unavailable");
  }
  if (!groqClient) {
    groqClient = new OpenAI({
      apiKey: env.GROQ_API_KEY,
      baseURL: "https://api.groq.com/openai/v1",
    });
  }
  return groqClient;
}

export function isGroqAvailable(): boolean {
  return !!env.GROQ_API_KEY;
}

/**
 * Generate text using Groq (text-only, no vision).
 * Uses Llama 3.3 70B via OpenAI-compatible endpoint.
 * Pass jsonMode: true to force JSON output (for structured data).
 */
export async function groqGenerateText(
  prompt: string,
  opts?: { jsonMode?: boolean },
): Promise<string> {
  const client = getGroq();
  logger.debug("Sending text request to Groq (Llama 3.3 70B)");

  const completion = await client.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.7,
    max_tokens: 4096,
    ...(opts?.jsonMode && { response_format: { type: "json_object" as const } }),
  });

  return completion.choices[0]?.message?.content ?? "";
}

/**
 * Generate text from an image using Groq Vision (Llama 3.2 Vision).
 * Uses OpenAI-compatible vision format.
 */
export async function groqGenerateVision(
  prompt: string,
  imageBase64: string,
  mimeType: string,
): Promise<string> {
  const client = getGroq();
  logger.debug("Sending vision request to Groq (Llama 3.2 11B Vision)");

  const completion = await client.chat.completions.create({
    model: "llama-3.2-11b-vision-preview",
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          {
            type: "image_url",
            image_url: {
              url: `data:${mimeType};base64,${imageBase64}`,
            },
          },
        ],
      },
    ],
    temperature: 0.7,
    max_tokens: 4096,
  });

  return completion.choices[0]?.message?.content ?? "";
}

/**
 * Transcribe audio using Groq Whisper via OpenAI-compatible endpoint.
 */
export async function groqTranscribeAudio(
  audioBase64: string,
  mimeType: string,
): Promise<{ text: string; language: string | null }> {
  const client = getGroq();

  const ext = mimeType.split("/")[1] || "m4a";
  const tmpPath = path.join(os.tmpdir(), `audio-${Date.now()}.${ext}`);
  fs.writeFileSync(tmpPath, Buffer.from(audioBase64, "base64"));

  logger.debug({ mimeType }, "Sending audio to Groq Whisper for transcription");

  try {
    const transcription = await client.audio.transcriptions.create({
      file: fs.createReadStream(tmpPath),
      model: "whisper-large-v3",
      response_format: "verbose_json",
    });

    return {
      text: transcription.text ?? "",
      language: (transcription as unknown as Record<string, unknown>).language as string | null ?? null,
    };
  } finally {
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      // ignore cleanup errors
    }
  }
}
