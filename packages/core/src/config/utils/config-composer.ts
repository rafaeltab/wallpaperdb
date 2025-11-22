import type { z } from "zod";

/**
 * Options for loading configuration.
 */
export interface LoadConfigOptions {
	/** Override values for testing */
	overrides?: Record<string, unknown>;
	/** Skip validation (useful for partial configs in tests) */
	skipValidation?: boolean;
}

/**
 * Creates a config loader for a given Zod schema.
 *
 * @example
 * ```typescript
 * const loadMyConfig = createConfigLoader(MyConfigSchema, () => ({
 *   port: parseIntEnv(process.env.PORT, 3001),
 *   databaseUrl: process.env.DATABASE_URL,
 * }));
 *
 * const config = loadMyConfig();
 * ```
 */
export function createConfigLoader<T extends z.ZodType>(
	schema: T,
	envMapper: () => Record<string, unknown>,
): (options?: LoadConfigOptions) => z.infer<T> {
	return (options?: LoadConfigOptions) => {
		const raw = { ...envMapper(), ...options?.overrides };

		if (options?.skipValidation) {
			return raw as z.infer<T>;
		}

		return schema.parse(raw);
	};
}

/**
 * To compose config schemas from multiple sources, use the spread operator
 * on the `.shape` property of each schema.
 *
 * @example
 * ```typescript
 * import { z } from "zod";
 * import { ServerConfigSchema, DatabaseConfigSchema } from "@wallpaperdb/core/config";
 *
 * const ServiceConfigSchema = z.object({
 *   ...ServerConfigSchema.shape,
 *   ...DatabaseConfigSchema.shape,
 *   // Add service-specific fields
 *   myServiceField: z.string(),
 * });
 *
 * type ServiceConfig = z.infer<typeof ServiceConfigSchema>;
 * ```
 */
