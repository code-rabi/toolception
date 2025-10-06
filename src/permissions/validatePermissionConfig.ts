import type { PermissionConfig } from "../types/index.js";

/**
 * Validates a permission configuration object to ensure it meets all requirements.
 * Throws descriptive errors for any validation failures.
 * @param config - The permission configuration to validate
 * @throws {Error} If the configuration is invalid or missing required fields
 */
export function validatePermissionConfig(config: PermissionConfig): void {
  validateConfigExists(config);
  validateSourceField(config);
  validateConfigBasedPermissions(config);
  validateTypes(config);
}

/**
 * Validates that the configuration object exists.
 * @param config - The permission configuration to validate
 * @throws {Error} If config is null, undefined, or not an object
 * @private
 */
function validateConfigExists(config: PermissionConfig): void {
  if (!config || typeof config !== "object") {
    throw new Error(
      "Permission configuration is required for createPermissionBasedMcpServer"
    );
  }
}

/**
 * Validates that the source field is present and has a valid value.
 * @param config - The permission configuration to validate
 * @throws {Error} If source is missing or not 'headers' or 'config'
 * @private
 */
function validateSourceField(config: PermissionConfig): void {
  if (!config.source) {
    throw new Error('Permission source must be either "headers" or "config"');
  }

  if (config.source !== "headers" && config.source !== "config") {
    throw new Error(
      `Invalid permission source: "${config.source}". Must be either "headers" or "config"`
    );
  }
}

/**
 * Validates config-based permission requirements.
 * When source is 'config', at least one of staticMap or resolver must be provided.
 * @param config - The permission configuration to validate
 * @throws {Error} If config source is used but neither staticMap nor resolver is provided
 * @private
 */
function validateConfigBasedPermissions(config: PermissionConfig): void {
  if (config.source === "config") {
    if (!config.staticMap && !config.resolver) {
      throw new Error(
        "Config-based permissions require at least one of: staticMap or resolver function"
      );
    }
  }
}

/**
 * Validates the types of configuration fields.
 * Ensures staticMap is an object and resolver is a function when provided.
 * @param config - The permission configuration to validate
 * @throws {Error} If staticMap or resolver have incorrect types
 * @private
 */
function validateTypes(config: PermissionConfig): void {
  if (config.staticMap !== undefined) {
    if (typeof config.staticMap !== "object" || config.staticMap === null) {
      throw new Error(
        "staticMap must be an object mapping client IDs to toolset arrays"
      );
    }

    // Validate that staticMap values are arrays
    validateStaticMapValues(config.staticMap);
  }

  if (config.resolver !== undefined) {
    if (typeof config.resolver !== "function") {
      throw new Error(
        "resolver must be a synchronous function: (clientId: string) => string[]"
      );
    }
  }

  if (config.defaultPermissions !== undefined) {
    if (!Array.isArray(config.defaultPermissions)) {
      throw new Error("defaultPermissions must be an array of toolset names");
    }
  }

  if (config.headerName !== undefined) {
    if (typeof config.headerName !== "string" || config.headerName.length === 0) {
      throw new Error("headerName must be a non-empty string");
    }
  }
}

/**
 * Validates that all values in the staticMap are arrays.
 * @param staticMap - The static map to validate
 * @throws {Error} If any value in the staticMap is not an array
 * @private
 */
function validateStaticMapValues(staticMap: Record<string, string[]>): void {
  for (const [clientId, permissions] of Object.entries(staticMap)) {
    if (!Array.isArray(permissions)) {
      throw new Error(
        `staticMap value for client "${clientId}" must be an array of toolset names`
      );
    }
  }
}
