import { GoogleGenerativeAI } from "@google/generative-ai";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";
import type { PluginHandler, PluginContext, PluginResult } from "./types.js";

const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY ?? "");

const FITNESS_PROMPT = `You are a fitness and nutrition expert AI. Analyze the detected objects and provide health/fitness insights.

For EACH relevant object, return:
- "objectName": the name of the object
- "category": one of "food", "equipment", "supplement", "wearable", "other"
- "insights": an object with:
  - For FOOD: { "calories": number, "protein": string, "carbs": string, "fat": string, "healthScore": 1-10, "mealSuggestion": string }
  - For EQUIPMENT: { "muscleGroups": string[], "difficulty": "beginner"|"intermediate"|"advanced", "suggestedExercises": string[], "caloriesBurnedPer30Min": number }
  - For SUPPLEMENT/WEARABLE/OTHER: { "fitnessRelevance": string, "recommendation": string }
- "tip": a single actionable fitness tip related to this object

Rules:
- Return ONLY a JSON object: { "results": [ ... ] }
- No markdown fences, no commentary — raw JSON only.
- Skip objects that have zero fitness/health relevance.
- Be specific with nutritional data — use reasonable estimates.`;

export const fitnessPlugin: PluginHandler = {
  slug: "fitness",
  name: "Fitness Coach",
  description:
    "Get nutritional info for food, exercise suggestions for equipment, and fitness insights for detected objects.",
  version: "1.0.0",
  icon: "💪",
  configSchema: {
    type: "object",
    properties: {
      goal: {
        type: "string",
        enum: ["lose_weight", "build_muscle", "maintain", "general_health"],
        default: "general_health",
        description: "Your fitness goal — affects recommendations",
      },
      unitSystem: {
        type: "string",
        enum: ["metric", "imperial"],
        default: "metric",
        description: "Unit system for measurements",
      },
    },
  },

  async process(ctx: PluginContext): Promise<PluginResult> {
    const objectNames = ctx.objects
      .map((o) => `- ${o.name}`)
      .join("\n");

    if (!objectNames) {
      return {
        pluginSlug: "fitness",
        pluginName: "Fitness Coach",
        cardType: "fitness",
        data: { results: [] },
      };
    }

    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

    const goal = (ctx.userConfig.goal as string) || "general_health";
    const units = (ctx.userConfig.unitSystem as string) || "metric";

    const prompt = `${FITNESS_PROMPT}\n\nDetected objects:\n${objectNames}\n\nUser fitness goal: ${goal}\nUnit system: ${units}`;

    const result = await model.generateContent(prompt);
    const text = result.response.text();

    let cleaned = text.trim();
    if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
    }

    try {
      const parsed = JSON.parse(cleaned);
      return {
        pluginSlug: "fitness",
        pluginName: "Fitness Coach",
        cardType: "fitness",
        data: { results: parsed.results ?? [] } as Record<string, unknown>,
      };
    } catch (err) {
      logger.warn({ err }, "Fitness plugin: failed to parse LLM response");
      return {
        pluginSlug: "fitness",
        pluginName: "Fitness Coach",
        cardType: "fitness",
        data: { results: [], error: "Failed to parse fitness data" },
      };
    }
  },
};
