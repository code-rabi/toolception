import type { SessionContextConfig } from "../types/index.js";

/**
 * Validates a session context configuration object to ensure it meets all requirements.
 * Throws descriptive errors for any validation failures.
 *
 * @param config - The session context configuration to validate
 */
export function validateSessionContextConfig(config: SessionContextConfig): void {
  validateConfigExists(config);
  validateEnabledField(config);
  validateQueryParamConfig(config);
  validateContextResolver(config);
  validateMergeStrategy(config);
}

/**
 * @param config - The session context configuration to validate
 */
function validateConfigExists(config: SessionContextConfig): void {
  if (!config || typeof config !== "object") {
    throw new Error(
      "Session context configuration must be an object"
    );
  }
}

/**
 * @param config - The session context configuration to validate
 */
function validateEnabledField(config: SessionContextConfig): void {
  if (config.enabled === undefined) {
    return;
  }

  if (typeof config.enabled !== "boolean") {
    throw new Error(
      `enabled must be a boolean, got ${typeof config.enabled}`
    );
  }
}

/**
 * @param config - The session context configuration to validate
 */
function validateQueryParamConfig(config: SessionContextConfig): void {
  if (config.queryParam === undefined) {
    return;
  }

  if (typeof config.queryParam !== "object" || config.queryParam === null) {
    throw new Error("queryParam must be an object");
  }

  // Validate name
  if (config.queryParam.name !== undefined) {
    if (
      typeof config.queryParam.name !== "string" ||
      config.queryParam.name.length === 0
    ) {
      throw new Error("queryParam.name must be a non-empty string");
    }
  }

  // Validate encoding
  if (config.queryParam.encoding !== undefined) {
    if (
      config.queryParam.encoding !== "base64" &&
      config.queryParam.encoding !== "json"
    ) {
      throw new Error(
        `Invalid queryParam.encoding: "${config.queryParam.encoding}". Must be "base64" or "json"`
      );
    }
  }

  // Validate allowedKeys
  if (config.queryParam.allowedKeys !== undefined) {
    if (!Array.isArray(config.queryParam.allowedKeys)) {
      throw new Error("queryParam.allowedKeys must be an array of strings");
    }

    for (let i = 0; i < config.queryParam.allowedKeys.length; i++) {
      const key = config.queryParam.allowedKeys[i];
      if (typeof key !== "string" || key.length === 0) {
        throw new Error(
          `queryParam.allowedKeys[${i}] must be a non-empty string`
        );
      }
    }
  }
}

/**
 * @param config - The session context configuration to validate
 */
function validateContextResolver(config: SessionContextConfig): void {
  if (config.contextResolver === undefined) {
    return;
  }

  if (typeof config.contextResolver !== "function") {
    throw new Error(
      "contextResolver must be a function: (request, baseContext, parsedQueryConfig?) => unknown"
    );
  }
}

/**
 * @param config - The session context configuration to validate
 */
function validateMergeStrategy(config: SessionContextConfig): void {
  if (config.merge === undefined) {
    return;
  }

  if (config.merge !== "shallow" && config.merge !== "deep") {
    throw new Error(
      `Invalid merge strategy: "${config.merge}". Must be "shallow" or "deep"`
    );
  }
}
