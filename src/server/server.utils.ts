import { z } from "zod";

/**
 * Zod schema for validating startup configuration.
 * Uses strict mode to reject unknown properties like 'initialToolsets'.
 */
export const startupConfigSchema = z
  .object({
    mode: z.enum(["DYNAMIC", "STATIC"]).optional(),
    toolsets: z.union([z.array(z.string()), z.literal("ALL")]).optional(),
  })
  .strict();
