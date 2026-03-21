import { generateJson } from "./ai-helper.js";
import { logger } from "../lib/logger.js";
import type { PluginHandler, PluginContext, PluginResult } from "./types.js";

const STYLE_MATCH_PROMPT = `You are an expert fashion stylist AI. Analyze detected clothing and outfit items and provide style advice.

For EACH clothing/outfit item, return:
- "objectName": the name of the item
- "styleRating": a score from 1 to 10 (10 = very stylish)
- "colorCoordination": analysis of the color scheme and how well colors work together
- "fashionStyle": the dominant style category (e.g. "casual", "formal", "streetwear", "bohemian", "minimalist", "athleisure", "vintage", "preppy")
- "complementaryPieces": an array of 3-5 suggested items that would pair well with this piece
- "stylingTips": an array of 2-3 actionable styling tips
- "seasonalFit": which seasons this item works best for

Rules:
- Return ONLY a JSON object: { "results": [ ... ] }
- No markdown fences, no commentary — raw JSON only.
- If an object is not a clothing/fashion item, skip it.
- Consider current fashion trends in your recommendations.`;

export const styleMatchPlugin: PluginHandler = {
  slug: "style-match",
  name: "Style Match",
  description:
    "Rate outfits, analyze color coordination, suggest complementary pieces, and identify fashion styles.",
  version: "1.0.0",
  icon: "👗",
  configSchema: {
    type: "object",
    properties: {
      stylePreference: {
        type: "string",
        default: "",
        description: "Preferred style (e.g. casual, formal, streetwear)",
      },
      gender: {
        type: "string",
        default: "",
        description: "Gender for tailored fashion suggestions",
      },
    },
  },

  async process(ctx: PluginContext): Promise<PluginResult> {
    const objectNames = ctx.objects
      .map((o) => `- ${o.name} (confidence: ${o.confidence})`)
      .join("\n");

    if (!objectNames) {
      return {
        pluginSlug: "style-match",
        pluginName: "Style Match",
        cardType: "style",
        data: { results: [] },
      };
    }

    const stylePreference = (ctx.userConfig.stylePreference as string) || "any";
    const gender = (ctx.userConfig.gender as string) || "unspecified";

    const prompt = `${STYLE_MATCH_PROMPT}\n\nDetected objects:\n${objectNames}\n\nStyle preference: ${stylePreference}\nGender: ${gender}`;

    try {
      const parsed = await generateJson<{ results: unknown[] }>(prompt);
      return {
        pluginSlug: "style-match",
        pluginName: "Style Match",
        cardType: "style",
        data: { results: parsed.results ?? [] } as Record<string, unknown>,
      };
    } catch (err) {
      logger.warn({ err }, "Style Match plugin: failed to generate or parse AI response");
      return {
        pluginSlug: "style-match",
        pluginName: "Style Match",
        cardType: "style",
        data: { results: [], error: "Failed to parse style data" },
      };
    }
  },
};
