import { pluginRegistry } from "./registry.js";
import { shoppingPlugin } from "./shopping.js";
import { fitnessPlugin } from "./fitness.js";
import { logger } from "../lib/logger.js";

/**
 * Register all built-in plugins.
 * Called once at app startup. Third-party plugins can be added here
 * or loaded dynamically from a directory/DB in the future.
 */
export async function bootstrapPlugins(): Promise<void> {
  const builtins = [shoppingPlugin, fitnessPlugin];

  for (const plugin of builtins) {
    await pluginRegistry.register(plugin);
  }

  logger.info(
    { count: builtins.length },
    "Plugin bootstrap complete",
  );
}
