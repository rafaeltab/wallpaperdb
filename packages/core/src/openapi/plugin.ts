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
 * Error response definition for OpenAPI documentation.
 */
export interface ErrorResponseDefinition {
	/** HTTP status code */
	statusCode: number;
	/** Description of when this error occurs */
	description: string;
}

/**
 * Multipart body schema configuration for OpenAPI documentation.
 */
export interface MultipartBodySchema {
	/** Route URL pattern (e.g., '/upload') */
	url: string;
	/** JSON Schema for the multipart body */
	schema: JsonSchema;
	/** Error responses to document (optional) */
	errorResponses?: ErrorResponseDefinition[];
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
	/** Additional schemas to register in components.schemas */
	additionalSchemas?: Record<string, JsonSchema>;
	/**
	 * Multipart body schemas for documentation.
	 * These are injected into the OpenAPI spec for routes that use multipart/form-data.
	 * Fastify doesn't validate multipart bodies, so these are for docs only.
	 */
	multipartBodies?: MultipartBodySchema[];
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

	// Register shared schemas with Fastify (for both serialization and OpenAPI)
	// These schemas can be referenced via $ref: '#/components/schemas/SchemaName'
	app.addSchema({
		$id: "HealthResponse",
		...(HealthResponseJsonSchema as object),
	});
	app.addSchema({
		$id: "ReadyResponse",
		...(ReadyResponseJsonSchema as object),
	});
	app.addSchema({
		$id: "ProblemDetails",
		...(ProblemDetailsJsonSchema as object),
	});
	app.addSchema({
		$id: "ValidationProblemDetails",
		...(ValidationProblemDetailsJsonSchema as object),
	});

	// Register additional schemas from the service
	if (options.additionalSchemas) {
		for (const [name, schema] of Object.entries(options.additionalSchemas)) {
			app.addSchema({
				$id: name,
				...(schema as object),
			});
		}
	}

	// Build multipart body lookup map
	const multipartBodyMap = new Map<string, JsonSchema>();
	if (options.multipartBodies) {
		for (const { url, schema } of options.multipartBodies) {
			multipartBodyMap.set(url, schema);
		}
	}

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
		// refResolver tells swagger to use the schemas we added via addSchema
		refResolver: {
			buildLocalReference(json, _baseUri, _fragment, _i) {
				// Use the $id as the reference name
				return json.$id as string;
			},
		},
		// Transform hook to inject multipart body schemas into OpenAPI spec
		transform: ({ schema, url }) => {
			// Check if this route has a multipart body schema to inject
			const multipartSchema = multipartBodyMap.get(url);
			if (multipartSchema) {
				// Clone the schema and add the body for OpenAPI docs only
				return {
					schema: {
						...schema,
						body: multipartSchema,
					},
					url,
				};
			}
			return { schema, url };
		},
	};
	await app.register(fastifySwagger, swaggerOptions);

	// Add hook to modify OpenAPI spec after generation for multipart endpoints
	const multipartBodies = options.multipartBodies;
	if (multipartBodies && multipartBodies.length > 0) {
		app.addHook("onReady", async () => {
			const swagger = app.swagger();
			for (const { url, schema, errorResponses } of multipartBodies) {
				// Find the path in the generated spec
				const pathItem = swagger.paths?.[url];
				if (pathItem?.post) {
					// Add requestBody for multipart (cast to allow modification)
					const postOp = pathItem.post as {
						requestBody?: unknown;
						responses: Record<string, unknown>;
					};
					postOp.requestBody = {
						required: true,
						content: {
							"multipart/form-data": {
								schema: schema as Record<string, unknown>,
							},
						},
					};
					// Add error responses if defined
					if (errorResponses) {
						for (const { statusCode, description } of errorResponses) {
							postOp.responses[statusCode] = {
								description,
								content: {
									"application/problem+json": {
										schema: { $ref: "#/components/schemas/ProblemDetails" },
									},
								},
							};
						}
					}
				}
			}
		});
	}

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
