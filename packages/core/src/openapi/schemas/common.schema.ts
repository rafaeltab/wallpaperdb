import { z } from "zod";
import { zodToJsonSchema } from "../utils/zod-to-json-schema.js";

/**
 * Pagination query parameters schema.
 */
export const PaginationQuerySchema = z.object({
	/** Number of items to skip */
	offset: z.coerce
		.number()
		.int()
		.min(0)
		.default(0)
		.describe("Number of items to skip"),
	/** Maximum number of items to return */
	limit: z.coerce
		.number()
		.int()
		.min(1)
		.max(100)
		.default(20)
		.describe("Maximum number of items to return"),
});

/**
 * Pagination metadata in response.
 */
export const PaginationMetaSchema = z.object({
	/** Total number of items */
	total: z.number().int().describe("Total number of items"),
	/** Number of items skipped */
	offset: z.number().int().describe("Number of items skipped"),
	/** Maximum number of items returned */
	limit: z.number().int().describe("Maximum number of items returned"),
	/** Whether there are more items */
	hasMore: z.boolean().describe("Whether there are more items"),
});

/**
 * Generic paginated response wrapper.
 */
export function createPaginatedResponseSchema<T extends z.ZodTypeAny>(
	itemSchema: T
) {
	return z.object({
		data: z.array(itemSchema).describe("Array of items"),
		pagination: PaginationMetaSchema.describe("Pagination metadata"),
	});
}

/**
 * Common ID parameter schema (ULID-based).
 */
export const IdParamSchema = z.object({
	id: z
		.string()
		.regex(/^[a-zA-Z0-9_]+_[0-9A-HJKMNP-TV-Z]{26}$/)
		.describe("Resource ID (format: prefix_ulid)"),
});

// Export types inferred from schemas
export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;
export type PaginationMeta = z.infer<typeof PaginationMetaSchema>;
export type IdParam = z.infer<typeof IdParamSchema>;

// Export JSON Schema versions for OpenAPI
export const PaginationQueryJsonSchema = zodToJsonSchema(PaginationQuerySchema, {
	name: "PaginationQuery",
});
export const PaginationMetaJsonSchema = zodToJsonSchema(PaginationMetaSchema, {
	name: "PaginationMeta",
});
export const IdParamJsonSchema = zodToJsonSchema(IdParamSchema, {
	name: "IdParam",
});
