import { generateJson } from "./ai-helper.js";
import { logger } from "../lib/logger.js";
import type { PluginHandler, PluginContext, PluginResult } from "./types.js";

const ROOM_DESIGN_PROMPT = `You are an expert interior designer AI. Analyze the detected objects as part of a room and provide design recommendations.

Return a single analysis object with:
- "detectedItems": an array of object names found in the room
- "currentStyle": the dominant interior design style identified (e.g. "modern", "minimalist", "bohemian", "industrial", "scandinavian", "traditional", "mid-century modern")
- "colorPalette": an object with:
  - "dominant": array of 3 dominant colors detected (as descriptive names, e.g. "warm beige")
  - "accent": array of 2 accent colors detected
  - "suggestedAdditions": array of 2-3 colors that would complement the palette
- "furnitureSuggestions": an array of 3-5 furniture or decor items to add, each with:
  - "item": item name
  - "reason": why it would improve the room
  - "estimatedCost": price range string
- "improvementTips": an array of 3-5 actionable tips to improve the room's design
- "estimatedBudget": total estimated budget range for all suggestions combined
- "moodAssessment": brief description of the mood/atmosphere the room conveys

Rules:
- Return ONLY a JSON object: { "results": <the analysis object> }
- No markdown fences, no commentary — raw JSON only.
- Tailor suggestions to the user's budget level.`;

export const roomDesignPlugin: PluginHandler = {
  slug: "room-design",
  name: "Room Designer",
  description:
    "Identify room styles, suggest complementary furniture and decor, analyze color palettes, and provide improvement tips.",
  version: "1.0.0",
  icon: "🏠",
  configSchema: {
    type: "object",
    properties: {
      budget: {
        type: "string",
        enum: ["low", "medium", "high"],
        default: "medium",
        description: "Budget level for design suggestions",
      },
      stylePreference: {
        type: "string",
        default: "",
        description: "Preferred interior design style",
      },
    },
  },

  async process(ctx: PluginContext): Promise<PluginResult> {
    const objectNames = ctx.objects
      .map((o) => `- ${o.name} (confidence: ${o.confidence})`)
      .join("\n");

    if (!objectNames) {
      return {
        pluginSlug: "room-design",
        pluginName: "Room Designer",
        cardType: "room-design",
        data: { results: [] },
      };
    }

    const budget = (ctx.userConfig.budget as string) || "medium";
    const stylePreference = (ctx.userConfig.stylePreference as string) || "any";

    const prompt = `${ROOM_DESIGN_PROMPT}\n\nDetected objects in the room:\n${objectNames}\n\nBudget level: ${budget}\nStyle preference: ${stylePreference}`;

    try {
      const parsed = await generateJson<{ results: unknown }>(prompt);
      return {
        pluginSlug: "room-design",
        pluginName: "Room Designer",
        cardType: "room-design",
        data: { results: parsed.results ?? [] } as Record<string, unknown>,
      };
    } catch (err) {
      logger.warn({ err }, "Room Design plugin: failed to generate or parse AI response");
      return {
        pluginSlug: "room-design",
        pluginName: "Room Designer",
        cardType: "room-design",
        data: { results: [], error: "Failed to parse room design data" },
      };
    }
  },
};
