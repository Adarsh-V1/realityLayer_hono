import { generateJson } from "./ai-helper.js";
import { logger } from "../lib/logger.js";
import type { PluginHandler, PluginContext, PluginResult } from "./types.js";

const PLANT_PET_PROMPT = `You are an expert botanist and veterinarian AI. Identify plants and animals from detected objects and provide detailed information.

For EACH plant, return:
- "objectName": the name of the object
- "type": "plant"
- "species": identified species or best guess
- "commonName": common name of the plant
- "careInstructions": a brief paragraph on how to care for this plant
- "wateringSchedule": how often to water (e.g. "Every 5-7 days")
- "sunlightNeeds": sunlight requirements (e.g. "Bright indirect light")
- "toxicityWarnings": an object { "toxic": boolean, "details": string } regarding toxicity to pets

For EACH animal, return:
- "objectName": the name of the object
- "type": "animal"
- "breed": identified breed or species
- "temperament": brief description of temperament
- "exerciseNeeds": exercise requirements (e.g. "30-60 minutes daily")
- "funFacts": an array of 2-3 fun facts about this animal

Rules:
- Return ONLY a JSON object: { "results": [ ... ] }
- No markdown fences, no commentary — raw JSON only.
- If an object is neither a plant nor an animal, skip it.`;

export const plantPetPlugin: PluginHandler = {
  slug: "plant-pet",
  name: "Plant & Pet ID",
  description:
    "Identify plants with care instructions and toxicity warnings, and animals with breed info, temperament, and fun facts.",
  version: "1.0.0",
  icon: "🌿",
  configSchema: {
    type: "object",
    properties: {
      hasPets: {
        type: "boolean",
        default: false,
        description: "Whether you have pets (enables toxicity warnings)",
      },
      petType: {
        type: "string",
        default: "",
        description: "Type of pet you own (e.g. dog, cat) for targeted toxicity info",
      },
    },
  },

  async process(ctx: PluginContext): Promise<PluginResult> {
    const objectNames = ctx.objects
      .map((o) => `- ${o.name} (confidence: ${o.confidence})`)
      .join("\n");

    if (!objectNames) {
      return {
        pluginSlug: "plant-pet",
        pluginName: "Plant & Pet ID",
        cardType: "plant-pet",
        data: { results: [] },
      };
    }

    const hasPets = (ctx.userConfig.hasPets as boolean) ?? false;
    const petType = (ctx.userConfig.petType as string) || "unknown";

    const prompt = `${PLANT_PET_PROMPT}\n\nDetected objects:\n${objectNames}\n\nUser has pets: ${hasPets}\nPet type: ${petType}`;

    try {
      const parsed = await generateJson<{ results: unknown[] }>(prompt);
      return {
        pluginSlug: "plant-pet",
        pluginName: "Plant & Pet ID",
        cardType: "plant-pet",
        data: { results: parsed.results ?? [] } as Record<string, unknown>,
      };
    } catch (err) {
      logger.warn({ err }, "Plant & Pet plugin: failed to generate or parse AI response");
      return {
        pluginSlug: "plant-pet",
        pluginName: "Plant & Pet ID",
        cardType: "plant-pet",
        data: { results: [], error: "Failed to parse plant/pet data" },
      };
    }
  },
};
