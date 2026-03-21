import { generateJson } from "./ai-helper.js";
import { logger } from "../lib/logger.js";
import type { PluginHandler, PluginContext, PluginResult } from "./types.js";

const OBJECT_HISTORY_PROMPT = `You are an expert historian and cultural analyst AI. Provide rich historical and cultural context for detected objects.

For EACH object, return:
- "objectName": the name of the object
- "origin": where and when the object (or its type) was first created or discovered
- "history": a concise paragraph about the object's history and evolution
- "funFacts": an array of 3 interesting facts about this type of object
- "famousAssociations": an array of 2-3 notable people, events, or cultural moments associated with this object
- "manufacturingDetails": brief info about how this type of object is typically made
- "collectorValue": an object with:
  - "isCollectible": boolean
  - "estimatedRange": price range if collectible, or "N/A"
  - "rarityLevel": one of "common", "uncommon", "rare", "very rare", "extremely rare"

Rules:
- Return ONLY a JSON object: { "results": [ ... ] }
- No markdown fences, no commentary — raw JSON only.
- Provide historically accurate information.
- If an object is too generic (e.g. "wall", "floor"), skip it.`;

export const objectHistoryPlugin: PluginHandler = {
  slug: "object-history",
  name: "Object History",
  description:
    "Discover the cultural and historical context of objects: origin, history, fun facts, famous associations, and collector value.",
  version: "1.0.0",
  icon: "📚",
  configSchema: {
    type: "object",
    properties: {
      detailLevel: {
        type: "string",
        enum: ["brief", "detailed"],
        default: "detailed",
        description: "Level of historical detail to provide",
      },
    },
  },

  async process(ctx: PluginContext): Promise<PluginResult> {
    const objectNames = ctx.objects
      .map((o) => `- ${o.name} (confidence: ${o.confidence})`)
      .join("\n");

    if (!objectNames) {
      return {
        pluginSlug: "object-history",
        pluginName: "Object History",
        cardType: "history",
        data: { results: [] },
      };
    }

    const detailLevel = (ctx.userConfig.detailLevel as string) || "detailed";

    const prompt = `${OBJECT_HISTORY_PROMPT}\n\nDetected objects:\n${objectNames}\n\nDetail level: ${detailLevel}`;

    try {
      const parsed = await generateJson<{ results: unknown[] }>(prompt);
      return {
        pluginSlug: "object-history",
        pluginName: "Object History",
        cardType: "history",
        data: { results: parsed.results ?? [] } as Record<string, unknown>,
      };
    } catch (err) {
      logger.warn({ err }, "Object History plugin: failed to generate or parse AI response");
      return {
        pluginSlug: "object-history",
        pluginName: "Object History",
        cardType: "history",
        data: { results: [], error: "Failed to parse object history data" },
      };
    }
  },
};
