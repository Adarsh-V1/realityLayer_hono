import { createXai } from "@ai-sdk/xai";
import { generateText } from "ai";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";

export function isXaiAvailable(): boolean {
  return !!env.XAI_API_KEY;
}

function getXai() {
  if (!env.XAI_API_KEY) {
    throw new Error("XAI_API_KEY not set — xAI fallback unavailable");
  }
  return createXai({ apiKey: env.XAI_API_KEY });
}

/**
 * Generate text using xAI Grok.
 * Uses Vercel AI SDK for clean integration.
 */
export async function xaiGenerateText(
  prompt: string,
  opts?: { jsonMode?: boolean },
): Promise<string> {
  const xai = getXai();
  logger.debug("Sending text request to xAI (Grok)");

  const { text } = await generateText({
    model: xai("grok-3-mini-fast"),
    prompt,
    ...(opts?.jsonMode && {
      experimental_providerMetadata: {
        xai: { outputFormat: "json" },
      },
    }),
  });

  return text;
}

/**
 * Generate text from an image using xAI Grok Vision.
 * Grok supports vision natively via base64 images.
 */
export async function xaiGenerateVision(
  prompt: string,
  imageBase64: string,
  _mimeType: string,
): Promise<string> {
  const xai = getXai();
  logger.debug("Sending vision request to xAI (Grok Vision)");

  const { text } = await generateText({
    model: xai("grok-2-vision-1212"),
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          {
            type: "image",
            image: Buffer.from(imageBase64, "base64"),
          },
        ],
      },
    ],
  });

  return text;
}
