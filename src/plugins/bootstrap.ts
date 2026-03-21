import { pluginRegistry } from "./registry.js";
import { shoppingPlugin } from "./shopping.js";
import { fitnessPlugin } from "./fitness.js";
import { nutritionPlugin } from "./nutrition.js";
import { plantPetPlugin } from "./plant-pet.js";
import { styleMatchPlugin } from "./style-match.js";
import { hagglePlugin } from "./haggle.js";
import { roomDesignPlugin } from "./room-design.js";
import { objectHistoryPlugin } from "./object-history.js";
import { comparisonPlugin } from "./comparison.js";
import { logger } from "../lib/logger.js";

/**
 * Register all built-in plugins.
 * Called once at app startup. Third-party plugins can be added here
 * or loaded dynamically from a directory/DB in the future.
 */
export async function bootstrapPlugins(): Promise<void> {
  const builtins = [
    shoppingPlugin,
    fitnessPlugin,
    nutritionPlugin,
    plantPetPlugin,
    styleMatchPlugin,
    hagglePlugin,
    roomDesignPlugin,
    objectHistoryPlugin,
    comparisonPlugin,
  ];

  for (const plugin of builtins) {
    await pluginRegistry.register(plugin);
  }

  logger.info(
    { count: builtins.length },
    "Plugin bootstrap complete",
  );
}
