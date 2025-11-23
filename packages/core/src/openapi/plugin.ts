import fastifySwagger, { type SwaggerOptions } from "@fastify/swagger";
import fastifySwaggerUi from "@fastify/swagger-ui";
import type { FastifyInstance } from "fastify";
import {
	HealthResponseJsonSchema,
	ReadyResponseJsonSchema,
	ProblemDetailsJsonSchema,
	ValidationProblemDetailsJsonSchema,
} from "./schemas/index.js";
import type { JsonSchema } from "./utils/zod-to-json-schema.js";

/**
 * Server configuration for OpenAPI spec.
 */
export interface OpenAPIServer {
	url: string;
	description?: string;
}

/**
 * Options for registering OpenAPI documentation.
 */
export interface OpenAPIOptions {
	/** API title */
	title: string;
	/** API version */
	version: string;
	/** API description */
	description?: string;
	/** List of server URLs */
	servers?: OpenAPIServer[];
	/** Route prefix for documentation endpoints (default: /documentation) */
	routePrefix?: string;
	/** Whether to expose the JSON spec at /documentation/json (default: true) */
	exposeRoute?: boolean;
}

/**
 * Registers OpenAPI documentation support with a Fastify instance.
 *
 * This registers:
 * - `@fastify/swagger` for generating OpenAPI 3.0 spec from route schemas
 * - `@fastify/swagger-ui` for serving Swagger UI at the specified route
 *
 * @param app - Fastify instance to register with
 * @param options - OpenAPI configuration options
 *
 * @example
 * ```typescript
 * import { registerOpenAPI } from '@wallpaperdb/core/openapi';
 *
 * const app = fastify();
 *
 * await registerOpenAPI(app, {
 *   title: 'My API',
 *   version: '1.0.0',
 *   description: 'My API description',
 * });
 * ```
 */
export async function registerOpenAPI(
	app: FastifyInstance,
	options: OpenAPIOptions
): Promise<void> {
	const routePrefix = options.routePrefix ?? "/documentation";

	// Register @fastify/swagger for OpenAPI spec generation
	const swaggerOptions: SwaggerOptions = {
		openapi: {
			openapi: "3.0.3",
			info: {
				title: options.title,
				version: options.version,
				description: options.description,
			},
			servers: options.servers,
			components: {
				schemas: {
					// Register shared schemas (cast to any for OpenAPI compatibility)
					HealthResponse: HealthResponseJsonSchema as JsonSchema,
					ReadyResponse: ReadyResponseJsonSchema as JsonSchema,
					ProblemDetails: ProblemDetailsJsonSchema as JsonSchema,
					ValidationProblemDetails:
						ValidationProblemDetailsJsonSchema as JsonSchema,
				},
				securitySchemes: {
					// Common auth scheme (can be extended per-service)
					userId: {
						type: "apiKey",
						in: "header",
						name: "x-user-id",
						description: "User ID for authentication",
					},
				},
			},
		},
	};
	await app.register(fastifySwagger, swaggerOptions);

	// Register @fastify/swagger-ui for serving Swagger UI
	await app.register(fastifySwaggerUi, {
		routePrefix,
		uiConfig: {
			docExpansion: "list",
			deepLinking: true,
			defaultModelsExpandDepth: 3,
			defaultModelExpandDepth: 3,
		},
		staticCSP: true,
	});
}
