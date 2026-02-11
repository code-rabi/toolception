import type {
  SessionContextConfig,
  SessionRequestContext,
} from "../types/index.js";
import { createHash } from "node:crypto";
import type { SessionContextResult } from "./session.types.js";

export class SessionContextResolver {
  private readonly config: SessionContextConfig;
  private readonly queryParamName: string;
  private readonly encoding: "base64" | "json";
  private readonly allowedKeys: Set<string> | null;
  private readonly mergeStrategy: "shallow" | "deep";

  constructor(config: SessionContextConfig) {
    this.config = config;
    this.queryParamName = config.queryParam?.name ?? "config";
    this.encoding = config.queryParam?.encoding ?? "base64";
    this.allowedKeys = config.queryParam?.allowedKeys
      ? new Set(config.queryParam.allowedKeys)
      : null;
    this.mergeStrategy = config.merge ?? "shallow";
  }

  static builder() {
    const opts: Partial<SessionContextConfig> = {};
    const builder = {
      enabled(value: boolean) { opts.enabled = value; return builder; },
      queryParam(value: SessionContextConfig["queryParam"]) { opts.queryParam = value; return builder; },
      contextResolver(value: SessionContextConfig["contextResolver"]) { opts.contextResolver = value; return builder; },
      merge(value: "shallow" | "deep") { opts.merge = value; return builder; },
      build() { return new SessionContextResolver(opts as SessionContextConfig); },
    };
    return builder;
  }

  /**
   * @param request - The request context (clientId, headers, query)
   * @param baseContext - The base context from server configuration
   * @returns The resolved context and cache key suffix
   */
  resolve(
    request: SessionRequestContext,
    baseContext: unknown
  ): SessionContextResult {
    // If disabled, return base context with default cache key
    if (this.config.enabled === false) {
      return {
        context: baseContext,
        cacheKeySuffix: "default",
      };
    }

    // Parse and filter the query parameter config
    const parsedConfig = this.parseQueryConfig(request.query);

    // If custom resolver is provided, use it
    if (this.config.contextResolver) {
      try {
        const resolvedContext = this.config.contextResolver(
          request,
          baseContext,
          parsedConfig
        );
        return {
          context: resolvedContext,
          cacheKeySuffix: this.generateCacheKeySuffix(parsedConfig),
        };
      } catch {
        // Fail secure: return base context on resolver error
        return {
          context: baseContext,
          cacheKeySuffix: "default",
        };
      }
    }

    // Default merge behavior
    const mergedContext = this.mergeContexts(baseContext, parsedConfig);
    return {
      context: mergedContext,
      cacheKeySuffix: this.generateCacheKeySuffix(parsedConfig),
    };
  }

  /**
   * @param query - Query parameters from the request
   * @returns Parsed and filtered config object
   */
  private parseQueryConfig(
    query: Record<string, string>
  ): Record<string, unknown> {
    const rawValue = query[this.queryParamName];
    if (!rawValue) {
      return {};
    }

    try {
      let jsonString: string;

      if (this.encoding === "base64") {
        // Decode base64 to JSON string
        jsonString = Buffer.from(rawValue, "base64").toString("utf-8");
      } else {
        // JSON encoding - value should already be JSON string
        jsonString = rawValue;
      }

      const parsed = JSON.parse(jsonString);

      // Must be an object
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        return {};
      }

      // Filter allowed keys if whitelist is configured
      return this.filterAllowedKeys(parsed);
    } catch {
      // Fail secure: return empty object on any parse error
      return {};
    }
  }

  /**
   * @param parsed - The parsed config object
   * @returns Filtered config with only allowed keys
   */
  private filterAllowedKeys(
    parsed: Record<string, unknown>
  ): Record<string, unknown> {
    if (!this.allowedKeys) {
      return parsed;
    }

    const filtered: Record<string, unknown> = {};
    for (const key of this.allowedKeys) {
      if (key in parsed) {
        filtered[key] = parsed[key];
      }
    }
    return filtered;
  }

  /**
   * @param baseContext - The base context from server configuration
   * @param sessionConfig - The parsed session config
   * @returns Merged context
   */
  private mergeContexts(
    baseContext: unknown,
    sessionConfig: Record<string, unknown>
  ): unknown {
    // If no session config, return base context as-is
    if (Object.keys(sessionConfig).length === 0) {
      return baseContext;
    }

    // If base context is not an object, session config takes precedence
    if (
      typeof baseContext !== "object" ||
      baseContext === null ||
      Array.isArray(baseContext)
    ) {
      return sessionConfig;
    }

    if (this.mergeStrategy === "deep") {
      return this.deepMerge(
        baseContext as Record<string, unknown>,
        sessionConfig
      );
    }

    // Shallow merge: session config overrides base context
    return {
      ...(baseContext as Record<string, unknown>),
      ...sessionConfig,
    };
  }

  /**
   * @param base - The base object
   * @param override - The override object
   * @returns Deep merged object
   */
  private deepMerge(
    base: Record<string, unknown>,
    override: Record<string, unknown>
  ): Record<string, unknown> {
    const result: Record<string, unknown> = { ...base };

    for (const [key, value] of Object.entries(override)) {
      const baseValue = result[key];

      if (
        typeof value === "object" &&
        value !== null &&
        !Array.isArray(value) &&
        typeof baseValue === "object" &&
        baseValue !== null &&
        !Array.isArray(baseValue)
      ) {
        // Both are objects - deep merge
        result[key] = this.deepMerge(
          baseValue as Record<string, unknown>,
          value as Record<string, unknown>
        );
      } else {
        // Override base value
        result[key] = value;
      }
    }

    return result;
  }

  /**
   * @param sessionConfig - The parsed session config
   * @returns Hash string or 'default'
   */
  private generateCacheKeySuffix(
    sessionConfig: Record<string, unknown>
  ): string {
    if (Object.keys(sessionConfig).length === 0) {
      return "default";
    }

    // Sort keys for deterministic hash
    const sortedKeys = Object.keys(sessionConfig).sort();
    const normalizedObj: Record<string, unknown> = {};
    for (const key of sortedKeys) {
      normalizedObj[key] = sessionConfig[key];
    }

    const jsonString = JSON.stringify(normalizedObj);
    return createHash("sha256").update(jsonString).digest("hex").slice(0, 16);
  }
}
