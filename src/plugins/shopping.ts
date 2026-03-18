import { GoogleGenerativeAI } from "@google/generative-ai";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";
import type { PluginHandler, PluginContext, PluginResult } from "./types.js";

const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY ?? "");

const SHOPPING_PROMPT = `You are a shopping assistant AI. Given a list of detected objects, provide shopping intelligence.

For EACH object, return:
- "objectName": the name of the object
- "searchQuery": an optimized search query a user could paste into Amazon/eBay/Google Shopping
- "estimatedPrice": current market price range as a string
- "deals": an array of 2-3 hypothetical but realistic deals with:
  - "source": store name (Amazon, eBay, Best Buy, Walmart, etc.)
  - "title": product listing title
  - "price": the deal price
  - "url": a plausible search URL (use https://www.google.com/search?q=<encoded_query>&tbm=shop)
- "buyRecommendation": a 1-sentence buy/wait/skip recommendation based on current pricing trends

Rules:
- Return ONLY a JSON object: { "results": [ ... ] }
- No markdown fences, no commentary — raw JSON only.
- Focus on the top 3 most shoppable objects.
- If an object is not a purchasable product, skip it.`;

export const shoppingPlugin: PluginHandler = {
  slug: "shopping",
  name: "Smart Shopping",
  description:
    "Find the best deals, compare prices, and get buy recommendations for detected objects.",
  version: "1.0.0",
  icon: "🛍️",
  configSchema: {
    type: "object",
    properties: {
      currency: {
        type: "string",
        default: "USD",
        description: "Preferred currency for price display",
      },
      maxResults: {
        type: "number",
        default: 3,
        description: "Max objects to find deals for",
      },
    },
  },

  async process(ctx: PluginContext): Promise<PluginResult> {
    const objectNames = ctx.objects
      .slice(0, (ctx.userConfig.maxResults as number) || 3)
      .map((o) => `- ${o.name} (confidence: ${o.confidence})`)
      .join("\n");

    if (!objectNames) {
      return {
        pluginSlug: "shopping",
        pluginName: "Smart Shopping",
        cardType: "shopping",
        data: { results: [] },
      };
    }

    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

    const prompt = `${SHOPPING_PROMPT}\n\nDetected objects:\n${objectNames}\n\nCurrency: ${(ctx.userConfig.currency as string) || "USD"}`;

    const result = await model.generateContent(prompt);
    const text = result.response.text();

    let cleaned = text.trim();
    if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
    }

    try {
      const parsed = JSON.parse(cleaned);
      return {
        pluginSlug: "shopping",
        pluginName: "Smart Shopping",
        cardType: "shopping",
        data: { results: parsed.results ?? [] } as Record<string, unknown>,
      };
    } catch (err) {
      logger.warn({ err }, "Shopping plugin: failed to parse LLM response");
      return {
        pluginSlug: "shopping",
        pluginName: "Smart Shopping",
        cardType: "shopping",
        data: { results: [], error: "Failed to parse shopping data" },
      };
    }
  },
};
