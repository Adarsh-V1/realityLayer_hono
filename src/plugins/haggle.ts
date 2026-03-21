import { generateJson } from "./ai-helper.js";
import { logger } from "../lib/logger.js";
import type { PluginHandler, PluginContext, PluginResult } from "./types.js";

const HAGGLE_PROMPT = `You are an expert marketplace negotiation AI. Analyze detected items as if they are being sold at a marketplace, garage sale, or thrift store, and provide haggling intelligence.

For EACH item, return:
- "objectName": the name of the item
- "fairMarketValue": estimated fair market value as a string (e.g. "$25-35")
- "recentSoldPrices": an array of 3 plausible recent sold prices with source (e.g. [{ "price": "$22", "source": "eBay", "condition": "good" }])
- "suggestedOfferPrice": the price you should open negotiations with
- "walkAwayPrice": the maximum you should pay
- "conditionAssessment": brief assessment of likely condition based on appearance
- "negotiationTips": an array of 3 negotiation strategies specific to this item
- "demandLevel": one of "high", "medium", "low" — how in-demand the item is

Rules:
- Return ONLY a JSON object: { "results": [ ... ] }
- No markdown fences, no commentary — raw JSON only.
- If an object is not something typically sold secondhand, skip it.
- Be realistic with pricing — consider used/secondhand market values.`;

export const hagglePlugin: PluginHandler = {
  slug: "haggle",
  name: "Haggle Helper",
  description:
    "Get fair market values, suggested offer prices, negotiation tips, and condition assessments for marketplace items.",
  version: "1.0.0",
  icon: "🤝",
  configSchema: {
    type: "object",
    properties: {
      currency: {
        type: "string",
        default: "USD",
        description: "Preferred currency for prices",
      },
      aggressiveness: {
        type: "string",
        enum: ["conservative", "moderate", "aggressive"],
        default: "moderate",
        description: "How aggressively to negotiate — affects suggested offer prices",
      },
    },
  },

  async process(ctx: PluginContext): Promise<PluginResult> {
    const objectNames = ctx.objects
      .map((o) => `- ${o.name} (confidence: ${o.confidence})`)
      .join("\n");

    if (!objectNames) {
      return {
        pluginSlug: "haggle",
        pluginName: "Haggle Helper",
        cardType: "haggle",
        data: { results: [] },
      };
    }

    const currency = (ctx.userConfig.currency as string) || "USD";
    const aggressiveness = (ctx.userConfig.aggressiveness as string) || "moderate";

    const prompt = `${HAGGLE_PROMPT}\n\nDetected objects:\n${objectNames}\n\nCurrency: ${currency}\nNegotiation style: ${aggressiveness}`;

    try {
      const parsed = await generateJson<{ results: unknown[] }>(prompt);
      return {
        pluginSlug: "haggle",
        pluginName: "Haggle Helper",
        cardType: "haggle",
        data: { results: parsed.results ?? [] } as Record<string, unknown>,
      };
    } catch (err) {
      logger.warn({ err }, "Haggle plugin: failed to generate or parse AI response");
      return {
        pluginSlug: "haggle",
        pluginName: "Haggle Helper",
        cardType: "haggle",
        data: { results: [], error: "Failed to parse haggle data" },
      };
    }
  },
};
