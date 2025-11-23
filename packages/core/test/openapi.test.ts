import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import {
  registerOpenAPI,
  zodToJsonSchema,
  HealthResponseSchema,
  HealthStatusSchema,
  ProblemDetailsSchema,
  HealthResponseJsonSchema,
  ProblemDetailsJsonSchema,
  PaginationQuerySchema,
  PaginationMetaSchema,
  ReadyResponseSchema,
} from "../src/openapi/index.js";

describe("OpenAPI Plugin Registration", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = Fastify({ logger: false });
  });

  afterEach(async () => {
    await app.close();
  });

  it("should register OpenAPI plugin with Fastify", async () => {
    await registerOpenAPI(app, {
      title: "Test API",
      version: "1.0.0",
    });

    await app.ready();

    // Plugin should be registered without errors
    expect(app).toBeDefined();
  });

  it("should serve OpenAPI JSON spec at /documentation/json", async () => {
    await registerOpenAPI(app, {
      title: "Test API",
      version: "1.0.0",
    });

    await app.ready();

    const response = await app.inject({
      method: "GET",
      url: "/documentation/json",
    });

    expect(response.statusCode).toBe(200);
    const spec = JSON.parse(response.payload);
    expect(spec.openapi).toBe("3.0.3");
    expect(spec.info.title).toBe("Test API");
    expect(spec.info.version).toBe("1.0.0");
  });

  it("should include description in spec", async () => {
    await registerOpenAPI(app, {
      title: "Test API",
      version: "1.0.0",
      description: "A test API description",
    });

    await app.ready();

    const response = await app.inject({
      method: "GET",
      url: "/documentation/json",
    });

    const spec = JSON.parse(response.payload);
    expect(spec.info.description).toBe("A test API description");
  });

  it("should include servers in spec", async () => {
    await registerOpenAPI(app, {
      title: "Test API",
      version: "1.0.0",
      servers: [
        { url: "http://localhost:3000", description: "Local server" },
        { url: "https://api.example.com", description: "Production" },
      ],
    });

    await app.ready();

    const response = await app.inject({
      method: "GET",
      url: "/documentation/json",
    });

    const spec = JSON.parse(response.payload);
    expect(spec.servers).toHaveLength(2);
    expect(spec.servers[0].url).toBe("http://localhost:3000");
    expect(spec.servers[1].url).toBe("https://api.example.com");
  });

  it("should include registered routes in spec", async () => {
    await registerOpenAPI(app, {
      title: "Test API",
      version: "1.0.0",
    });

    // Add a route with schema
    app.get(
      "/test",
      {
        schema: {
          summary: "Test endpoint",
          tags: ["Test"],
          response: {
            200: {
              type: "object",
              properties: {
                message: { type: "string" },
              },
            },
          },
        },
      },
      async () => ({ message: "hello" })
    );

    await app.ready();

    const response = await app.inject({
      method: "GET",
      url: "/documentation/json",
    });

    const spec = JSON.parse(response.payload);
    expect(spec.paths["/test"]).toBeDefined();
    expect(spec.paths["/test"].get).toBeDefined();
    expect(spec.paths["/test"].get.summary).toBe("Test endpoint");
  });

  it("should include shared schemas in components", async () => {
    await registerOpenAPI(app, {
      title: "Test API",
      version: "1.0.0",
    });

    await app.ready();

    const response = await app.inject({
      method: "GET",
      url: "/documentation/json",
    });

    const spec = JSON.parse(response.payload);
    expect(spec.components.schemas.HealthResponse).toBeDefined();
    expect(spec.components.schemas.ProblemDetails).toBeDefined();
    expect(spec.components.schemas.ReadyResponse).toBeDefined();
  });

  it("should serve Swagger UI at /documentation", async () => {
    await registerOpenAPI(app, {
      title: "Test API",
      version: "1.0.0",
    });

    await app.ready();

    const response = await app.inject({
      method: "GET",
      url: "/documentation",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.payload).toContain("swagger");
  });

  it("should use custom route prefix", async () => {
    await registerOpenAPI(app, {
      title: "Test API",
      version: "1.0.0",
      routePrefix: "/api-docs",
    });

    await app.ready();

    const response = await app.inject({
      method: "GET",
      url: "/api-docs/json",
    });

    expect(response.statusCode).toBe(200);
  });
});

describe("Shared OpenAPI Schemas", () => {
  describe("HealthResponseSchema", () => {
    it("should validate valid health response", () => {
      const validData = {
        status: "healthy",
        checks: { db: true, cache: true },
        timestamp: new Date().toISOString(),
      };

      const result = HealthResponseSchema.safeParse(validData);
      expect(result.success).toBe(true);
    });

    it("should validate health response with optional fields", () => {
      const validData = {
        status: "error",
        checks: {},
        timestamp: new Date().toISOString(),
        error: "Something went wrong",
        totalDurationMs: 150,
      };

      const result = HealthResponseSchema.safeParse(validData);
      expect(result.success).toBe(true);
    });

    it("should reject invalid status", () => {
      const invalidData = {
        status: "invalid",
        checks: {},
        timestamp: new Date().toISOString(),
      };

      const result = HealthResponseSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it("should have correct JSON Schema structure", () => {
      expect(HealthResponseJsonSchema).toBeDefined();
      const schema = HealthResponseJsonSchema as Record<string, unknown>;
      expect(schema.type).toBe("object");
      expect(schema.properties).toBeDefined();
    });
  });

  describe("HealthStatusSchema", () => {
    it("should accept all valid statuses", () => {
      const validStatuses = ["healthy", "unhealthy", "degraded", "error", "shutting_down"];

      for (const status of validStatuses) {
        const result = HealthStatusSchema.safeParse(status);
        expect(result.success).toBe(true);
      }
    });
  });

  describe("ProblemDetailsSchema", () => {
    it("should validate valid RFC 7807 problem details", () => {
      const validData = {
        type: "https://example.com/problems/validation-error",
        title: "Validation Error",
        status: 400,
        detail: "The request body is invalid",
        instance: "/api/upload",
      };

      const result = ProblemDetailsSchema.safeParse(validData);
      expect(result.success).toBe(true);
    });

    it("should allow extension fields", () => {
      const validData = {
        type: "https://example.com/problems/validation-error",
        title: "Validation Error",
        status: 400,
        detail: "The request body is invalid",
        instance: "/api/upload",
        customField: "custom value",
        errors: [{ field: "name", message: "required" }],
      };

      const result = ProblemDetailsSchema.safeParse(validData);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.customField).toBe("custom value");
      }
    });

    it("should have correct JSON Schema structure", () => {
      expect(ProblemDetailsJsonSchema).toBeDefined();
      const schema = ProblemDetailsJsonSchema as Record<string, unknown>;
      expect(schema.type).toBe("object");
    });
  });

  describe("ReadyResponseSchema", () => {
    it("should validate ready response", () => {
      const validData = {
        ready: true,
        timestamp: new Date().toISOString(),
      };

      const result = ReadyResponseSchema.safeParse(validData);
      expect(result.success).toBe(true);
    });

    it("should validate not ready response with reason", () => {
      const validData = {
        ready: false,
        timestamp: new Date().toISOString(),
        reason: "Database not connected",
      };

      const result = ReadyResponseSchema.safeParse(validData);
      expect(result.success).toBe(true);
    });
  });

  describe("PaginationSchemas", () => {
    it("should validate pagination query params", () => {
      const validData = {
        offset: 0,
        limit: 20,
      };

      const result = PaginationQuerySchema.safeParse(validData);
      expect(result.success).toBe(true);
    });

    it("should apply defaults for pagination query", () => {
      const result = PaginationQuerySchema.parse({});
      expect(result.offset).toBe(0);
      expect(result.limit).toBe(20);
    });

    it("should validate pagination meta", () => {
      const validData = {
        total: 100,
        offset: 0,
        limit: 20,
        hasMore: true,
      };

      const result = PaginationMetaSchema.safeParse(validData);
      expect(result.success).toBe(true);
    });
  });
});

describe("Zod to JSON Schema Conversion", () => {
  it("should convert simple object schema", () => {
    const schema = z.object({
      name: z.string(),
      age: z.number(),
    });

    const jsonSchema = zodToJsonSchema(schema) as Record<string, unknown>;

    expect(jsonSchema.type).toBe("object");
    const properties = jsonSchema.properties as Record<string, unknown>;
    expect(properties.name).toBeDefined();
    expect(properties.age).toBeDefined();
  });

  it("should convert enum schema", () => {
    const schema = z.enum(["a", "b", "c"]);

    const jsonSchema = zodToJsonSchema(schema) as Record<string, unknown>;

    expect(jsonSchema.enum).toEqual(["a", "b", "c"]);
  });

  it("should convert schema with descriptions", () => {
    const schema = z.object({
      name: z.string().describe("The user name"),
    });

    const jsonSchema = zodToJsonSchema(schema) as Record<string, unknown>;
    const properties = jsonSchema.properties as Record<string, Record<string, unknown>>;

    expect(properties.name.description).toBe("The user name");
  });

  it("should handle optional fields", () => {
    const schema = z.object({
      required: z.string(),
      optional: z.string().optional(),
    });

    const jsonSchema = zodToJsonSchema(schema) as Record<string, unknown>;

    expect(jsonSchema.required).toContain("required");
    expect(jsonSchema.required).not.toContain("optional");
  });

  it("should handle arrays", () => {
    const schema = z.array(z.string());

    const jsonSchema = zodToJsonSchema(schema) as Record<string, unknown>;

    expect(jsonSchema.type).toBe("array");
    const items = jsonSchema.items as Record<string, unknown>;
    expect(items.type).toBe("string");
  });

  it("should handle nested objects", () => {
    const schema = z.object({
      user: z.object({
        name: z.string(),
      }),
    });

    const jsonSchema = zodToJsonSchema(schema) as Record<string, unknown>;
    const properties = jsonSchema.properties as Record<string, Record<string, unknown>>;

    expect(properties.user.type).toBe("object");
  });
});
