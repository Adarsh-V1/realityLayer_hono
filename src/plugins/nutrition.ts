import { generateJson } from "./ai-helper.js";
import { logger } from "../lib/logger.js";
import type { PluginHandler, PluginContext, PluginResult } from "./types.js";

const NUTRITION_PROMPT = `You are an expert nutritionist AI. Analyze the detected food items and provide detailed nutritional information.

For EACH food item, return:
- "objectName": the name of the food item
- "calories": estimated calorie count (number)
- "macros": { "protein": string, "carbs": string, "fat": string, "fiber": string }
- "portionSize": estimated portion size as a string (e.g. "1 medium apple, ~182g")
- "healthScore": a score from 1 to 10 (10 = very healthy)
- "allergens": an array of common allergens present (e.g. ["gluten", "dairy", "nuts"])
- "mealSuggestions": an array of 2-3 meal ideas incorporating this food

Rules:
- Return ONLY a JSON object: { "results": [ ... ] }
- No markdown fences, no commentary — raw JSON only.
- If an object is not a food item, skip it.
- Be specific with nutritional estimates based on standard serving sizes.`;

export const nutritionPlugin: PluginHandler = {
  slug: "nutrition",
  name: "Nutrition Scanner",
  description:
    "Analyze food items for calories, macros, portion size, health score, allergens, and meal suggestions.",
  version: "1.0.0",
  icon: "🥗",
  configSchema: {
    type: "object",
    properties: {
      dietaryRestrictions: {
        type: "string",
        default: "",
        description: "Dietary restrictions (e.g. vegan, gluten-free, keto)",
      },
      dailyCalorieTarget: {
        type: "number",
        default: 2000,
        description: "Daily calorie target for context",
      },
    },
  },

  async process(ctx: PluginContext): Promise<PluginResult> {
    const objectNames = ctx.objects
      .map((o) => `- ${o.name} (confidence: ${o.confidence})`)
      .join("\n");

    if (!objectNames) {
      return {
        pluginSlug: "nutrition",
        pluginName: "Nutrition Scanner",
        cardType: "nutrition",
        data: { results: [] },
      };
    }

    const restrictions = (ctx.userConfig.dietaryRestrictions as string) || "none";
    const calorieTarget = (ctx.userConfig.dailyCalorieTarget as number) || 2000;

    const prompt = `${NUTRITION_PROMPT}\n\nDetected objects:\n${objectNames}\n\nDietary restrictions: ${restrictions}\nDaily calorie target: ${calorieTarget}`;

    try {
      const parsed = await generateJson<{ results: unknown[] }>(prompt);
      return {
        pluginSlug: "nutrition",
        pluginName: "Nutrition Scanner",
        cardType: "nutrition",
        data: { results: parsed.results ?? [] } as Record<string, unknown>,
      };
    } catch (err) {
      logger.warn({ err }, "Nutrition plugin: failed to generate or parse AI response");
      return {
        pluginSlug: "nutrition",
        pluginName: "Nutrition Scanner",
        cardType: "nutrition",
        data: { results: [], error: "Failed to parse nutrition data" },
      };
    }
  },
};
