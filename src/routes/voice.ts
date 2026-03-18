import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../lib/types.js";
import { success, error } from "../lib/api-response.js";
import { logger } from "../lib/logger.js";
import { transcribeAudio } from "../services/whisper.js";
import { generateVoiceResponse } from "../services/voice-conversation.js";

export const voiceRoute = new Hono<AppEnv>();

// Max 25 MB audio payload
const MAX_AUDIO_LENGTH = 25 * 1024 * 1024;

const voiceBodySchema = z.object({
  audio: z.string().min(1, "audio is required"),
  audioMimeType: z.string().optional().default("audio/m4a"),
  /** Scan context: detected objects to inform the AI response */
  objects: z
    .array(
      z.object({
        name: z.string(),
        confidence: z.number(),
        summary: z.string(),
        price: z.string(),
      }),
    )
    .optional()
    .default([]),
  /** Optional image for multimodal context */
  imageBase64: z.string().optional(),
  imageMimeType: z.string().optional(),
  /** Conversation history for multi-turn */
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        text: z.string(),
      }),
    )
    .optional()
    .default([]),
});

/**
 * POST /api/voice
 *
 * Full voice interaction pipeline:
 *   1. Receive audio (base64) + scan context
 *   2. Transcribe with Gemini (speech → text)
 *   3. Generate contextual AI response via Gemini
 *   4. Return transcript + reply (frontend handles TTS)
 */
voiceRoute.post("/voice", async (c) => {
  const body = await c.req.json();
  const parsed = voiceBodySchema.safeParse(body);

  if (!parsed.success) {
    return error(c, "INVALID_INPUT", parsed.error.issues[0].message, 400);
  }

  const { audio, audioMimeType, objects, imageBase64, imageMimeType, history } =
    parsed.data;

  // Validate audio size
  if (audio.length > MAX_AUDIO_LENGTH) {
    return error(c, "PAYLOAD_TOO_LARGE", "Audio must be under 25 MB", 413);
  }

  const requestId = c.get("requestId");
  logger.info(
    {
      requestId,
      audioSize: audio.length,
      audioMimeType,
      objectCount: objects.length,
      hasImage: !!imageBase64,
      historyLength: history.length,
    },
    "Voice request received",
  );

  const pipelineStart = Date.now();

  // Step 1: Transcribe audio → text
  let transcript: string;
  let transcriptionTimeMs: number;

  try {
    const transcription = await transcribeAudio(audio, audioMimeType);
    transcript = transcription.text;
    transcriptionTimeMs = transcription.durationMs;
  } catch (err) {
    logger.error({ err, requestId }, "Gemini transcription failed");
    return error(
      c,
      "TRANSCRIPTION_FAILED",
      err instanceof Error ? err.message : "Failed to transcribe audio",
      502,
    );
  }

  if (!transcript.trim()) {
    return success(c, {
      transcript: "",
      reply: "I didn't catch that. Could you try speaking again?",
      timing: { transcriptionMs: transcriptionTimeMs, responseMs: 0, totalMs: Date.now() - pipelineStart },
    });
  }

  // Step 2: Generate AI response with scan context
  let reply: string;
  let responseTimeMs: number;

  try {
    const voiceResponse = await generateVoiceResponse({
      transcript,
      objects: objects.length > 0 ? objects : undefined,
      imageBase64,
      imageMimeType,
      history,
    });
    reply = voiceResponse.reply;
    responseTimeMs = voiceResponse.processingTimeMs;
  } catch (err) {
    logger.error({ err, requestId }, "Voice response generation failed");
    return error(
      c,
      "RESPONSE_FAILED",
      "Failed to generate AI response",
      502,
    );
  }

  const totalMs = Date.now() - pipelineStart;

  logger.info(
    {
      requestId,
      transcriptLength: transcript.length,
      replyLength: reply.length,
      transcriptionMs: transcriptionTimeMs,
      responseMs: responseTimeMs,
      totalMs,
    },
    "Voice pipeline complete",
  );

  return success(c, {
    transcript,
    reply,
    timing: {
      transcriptionMs: transcriptionTimeMs,
      responseMs: responseTimeMs,
      totalMs,
    },
  });
});

/**
 * POST /api/voice/transcribe
 *
 * Transcription-only endpoint (no AI response).
 * Useful for speech-to-text in other contexts.
 */
voiceRoute.post("/voice/transcribe", async (c) => {
  const body = await c.req.json();
  const parsed = z
    .object({
      audio: z.string().min(1),
      audioMimeType: z.string().optional().default("audio/m4a"),
    })
    .safeParse(body);

  if (!parsed.success) {
    return error(c, "INVALID_INPUT", parsed.error.issues[0].message, 400);
  }

  if (parsed.data.audio.length > MAX_AUDIO_LENGTH) {
    return error(c, "PAYLOAD_TOO_LARGE", "Audio must be under 25 MB", 413);
  }

  try {
    const result = await transcribeAudio(
      parsed.data.audio,
      parsed.data.audioMimeType,
    );
    return success(c, result);
  } catch (err) {
    logger.error({ err }, "Transcription-only request failed");
    return error(
      c,
      "TRANSCRIPTION_FAILED",
      err instanceof Error ? err.message : "Transcription failed",
      502,
    );
  }
});
