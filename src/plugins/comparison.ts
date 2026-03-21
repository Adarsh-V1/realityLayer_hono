import { generateJson } from "./ai-helper.js";
import { logger } from "../lib/logger.js";
import type { PluginHandler, PluginContext, PluginResult } from "./types.js";

const COMPARISON_PROMPT = `You are an expert product comparison AI. Compare the detected objects against each other and provide detailed comparison analysis.

Return a comparison object with:
- "comparedItems": an array of the item names being compared
- "featureComparison": an array of feature rows, each with:
  - "feature": the feature name (e.g. "Durability", "Portability", "Price Range")
  - "values": an object mapping each item name to its rating or value for this feature
- "valueForMoney": an object mapping each item name to a rating from 1 to 10
- "prosAndCons": an object mapping each item name to:
  - "pros": an array of 2-3 advantages
  - "cons": an array of 2-3 disadvantages
- "winner": an object with:
  - "item": the recommended item name
  - "reason": a brief explanation of why it wins
  - "bestFor": what type of user/use case it's best for
- "summary": a 2-3 sentence overall comparison summary

Rules:
- Return ONLY a JSON object: { "results": <the comparison object> }
- No markdown fences, no commentary — raw JSON only.
- If only one object is detected, compare it against its common alternatives.
- If objects are not comparable (e.g. a chair and a banana), note that and provide individual assessments instead.`;

export const comparisonPlugin: PluginHandler = {
  slug: "comparison",
  name: "Compare Mode",
  description:
    "Compare detected objects with feature tables, value-for-money ratings, pros/cons, and winner recommendations.",
  version: "1.0.0",
  icon: "⚖️",
  configSchema: {
    type: "object",
    properties: {
      prioritize: {
        type: "string",
        enum: ["price", "quality", "value"],
        default: "value",
        description: "What to prioritize when determining the winner",
      },
    },
  },

  async process(ctx: PluginContext): Promise<PluginResult> {
    const objectNames = ctx.objects
      .map((o) => `- ${o.name} (confidence: ${o.confidence})`)
      .join("\n");

    if (!objectNames) {
      return {
        pluginSlug: "comparison",
        pluginName: "Compare Mode",
        cardType: "comparison",
        data: { results: [] },
      };
    }

    const prioritize = (ctx.userConfig.prioritize as string) || "value";

    const prompt = `${COMPARISON_PROMPT}\n\nDetected objects:\n${objectNames}\n\nPrioritize: ${prioritize}`;

    try {
      const parsed = await generateJson<{ results: unknown }>(prompt);
      return {
        pluginSlug: "comparison",
        pluginName: "Compare Mode",
        cardType: "comparison",
        data: { results: parsed.results ?? [] } as Record<string, unknown>,
      };
    } catch (err) {
      logger.warn({ err }, "Comparison plugin: failed to generate or parse AI response");
      return {
        pluginSlug: "comparison",
        pluginName: "Compare Mode",
        cardType: "comparison",
        data: { results: [], error: "Failed to parse comparison data" },
      };
    }
  },
};
