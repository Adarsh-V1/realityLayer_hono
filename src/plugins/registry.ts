import { logger } from "../lib/logger.js";
import type { PluginHandler, PluginContext, PluginResult } from "./types.js";

/** How long a single plugin.process() is allowed to run (ms) */
const PLUGIN_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// Plugin Registry — singleton that manages all loaded plugin handlers
// ---------------------------------------------------------------------------

class PluginRegistry {
  private handlers = new Map<string, PluginHandler>();

  /** Register a plugin handler. Calls onRegister() if defined. */
  async register(handler: PluginHandler): Promise<void> {
    if (this.handlers.has(handler.slug)) {
      logger.warn({ slug: handler.slug }, "Plugin already registered — skipping");
      return;
    }

    if (handler.onRegister) {
      try {
        await handler.onRegister();
      } catch (err) {
        logger.error({ err, slug: handler.slug }, "Plugin onRegister failed");
        return;
      }
    }

    this.handlers.set(handler.slug, handler);
    logger.info(
      { slug: handler.slug, version: handler.version },
      "Plugin registered",
    );
  }

  /** Get a handler by slug */
  get(slug: string): PluginHandler | undefined {
    return this.handlers.get(slug);
  }

  /** List all registered handler metadata (no process fn) */
  listAll(): Array<{
    slug: string;
    name: string;
    description: string;
    version: string;
    icon: string;
    configSchema: Record<string, unknown>;
  }> {
    return Array.from(this.handlers.values()).map((h) => ({
      slug: h.slug,
      name: h.name,
      description: h.description,
      version: h.version,
      icon: h.icon,
      configSchema: h.configSchema,
    }));
  }

  /**
   * Execute a set of plugins concurrently against a scan context.
   *
   * Each plugin runs in its own error boundary with a timeout.
   * Failed plugins return null — they never crash the pipeline.
   *
   * @param configMap - per-plugin user config keyed by slug
   */
  async execute(
    slugs: string[],
    ctx: Omit<PluginContext, "userConfig">,
    configMap: Record<string, Record<string, unknown>> = {},
  ): Promise<PluginResult[]> {
    const tasks = slugs
      .map((slug) => this.handlers.get(slug))
      .filter((h): h is PluginHandler => !!h)
      .map((handler) =>
        this.runWithTimeout(handler, {
          ...ctx,
          userConfig: configMap[handler.slug] ?? {},
        }),
      );

    const settled = await Promise.allSettled(tasks);

    return settled
      .filter(
        (r): r is PromiseFulfilledResult<PluginResult | null> =>
          r.status === "fulfilled" && r.value !== null,
      )
      .map((r) => r.value!);
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private async runWithTimeout(
    handler: PluginHandler,
    ctx: PluginContext,
  ): Promise<PluginResult | null> {
    try {
      const result = await Promise.race([
        handler.process(ctx),
        this.timeout(PLUGIN_TIMEOUT_MS, handler.slug),
      ]);

      // Ensure pluginSlug/Name are set correctly
      return {
        ...result,
        pluginSlug: handler.slug,
        pluginName: handler.name,
      };
    } catch (err) {
      logger.error(
        { err, slug: handler.slug },
        "Plugin execution failed — skipping",
      );
      return null;
    }
  }

  private timeout(ms: number, slug: string): Promise<never> {
    return new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error(`Plugin "${slug}" timed out after ${ms}ms`)),
        ms,
      ),
    );
  }
}

/** Singleton registry instance */
export const pluginRegistry = new PluginRegistry();
