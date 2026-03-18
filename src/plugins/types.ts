import type { ObjectInsight } from "../services/gemini.js";

// ---------------------------------------------------------------------------
// Plugin lifecycle & interface
// ---------------------------------------------------------------------------

/** Context passed to every plugin hook */
export interface PluginContext {
  /** Detected objects from the vision pipeline */
  objects: ObjectInsight[];
  /** Raw base64 image data */
  imageBase64: string;
  /** MIME type of the image */
  imageMimeType: string;
  /** Per-user plugin configuration (from userPlugins.config) */
  userConfig: Record<string, unknown>;
}

/** The result a plugin returns after processing */
export interface PluginResult {
  /** Plugin slug (auto-set by registry) */
  pluginSlug: string;
  /** Plugin display name */
  pluginName: string;
  /** Structured data the frontend can render */
  data: Record<string, unknown>;
  /** Optional UI hint for the frontend (card type) */
  cardType?: string;
}

/**
 * The contract every plugin must implement.
 *
 * Plugins are stateless processors — they receive context and return
 * enriched data. The registry handles lifecycle and error isolation.
 */
export interface PluginHandler {
  /** Unique slug — must match the `plugins` DB row */
  slug: string;
  /** Human-readable name */
  name: string;
  /** Short description */
  description: string;
  /** SemVer version */
  version: string;
  /** Icon URL or emoji fallback */
  icon: string;
  /**
   * JSON Schema describing the user-configurable options.
   * Stored in `plugins.config_schema` for frontend form generation.
   */
  configSchema: Record<string, unknown>;

  /**
   * Called when the plugin is first registered.
   * Use for one-time setup like warming caches.
   */
  onRegister?(): Promise<void> | void;

  /**
   * The main processing hook. Receives scan context and returns
   * enriched data that gets merged into the API response.
   *
   * Must not throw — return an error-shaped result instead.
   * The registry wraps this in a timeout + try/catch regardless.
   */
  process(ctx: PluginContext): Promise<PluginResult>;
}
