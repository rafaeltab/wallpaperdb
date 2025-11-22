import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { z } from "zod";
import {
	ServerConfigSchema,
	DatabaseConfigSchema,
	S3ConfigSchema,
	NatsConfigSchema,
	RedisConfigSchema,
	OtelConfigSchema,
	parseIntEnv,
	parseBoolEnv,
	getEnv,
	requireEnv,
	createConfigLoader,
} from "../src/config/index.js";

describe("Config Schemas", () => {
	describe("ServerConfigSchema", () => {
		it("should validate valid config", () => {
			const config = ServerConfigSchema.parse({
				port: 3000,
				nodeEnv: "production",
			});

			expect(config.port).toBe(3000);
			expect(config.nodeEnv).toBe("production");
		});

		it("should apply defaults", () => {
			const config = ServerConfigSchema.parse({});

			expect(config.port).toBe(3001);
			expect(config.nodeEnv).toBe("development");
		});

		it("should reject invalid nodeEnv", () => {
			expect(() =>
				ServerConfigSchema.parse({ nodeEnv: "invalid" }),
			).toThrow();
		});

		it("should reject invalid port", () => {
			expect(() => ServerConfigSchema.parse({ port: -1 })).toThrow();
			expect(() => ServerConfigSchema.parse({ port: "abc" })).toThrow();
		});
	});

	describe("DatabaseConfigSchema", () => {
		it("should validate valid config", () => {
			const config = DatabaseConfigSchema.parse({
				databaseUrl: "postgresql://localhost:5432/db",
			});

			expect(config.databaseUrl).toBe("postgresql://localhost:5432/db");
		});

		it("should reject invalid URL", () => {
			expect(() =>
				DatabaseConfigSchema.parse({ databaseUrl: "not-a-url" }),
			).toThrow();
		});

		it("should reject missing URL", () => {
			expect(() => DatabaseConfigSchema.parse({})).toThrow();
		});
	});

	describe("S3ConfigSchema", () => {
		it("should validate valid config", () => {
			const config = S3ConfigSchema.parse({
				s3Endpoint: "http://localhost:9000",
				s3AccessKeyId: "minioadmin",
				s3SecretAccessKey: "minioadmin",
			});

			expect(config.s3Endpoint).toBe("http://localhost:9000");
			expect(config.s3Bucket).toBe("wallpapers"); // default
			expect(config.s3Region).toBe("us-east-1"); // default
		});

		it("should reject empty credentials", () => {
			expect(() =>
				S3ConfigSchema.parse({
					s3Endpoint: "http://localhost:9000",
					s3AccessKeyId: "",
					s3SecretAccessKey: "secret",
				}),
			).toThrow();
		});
	});

	describe("NatsConfigSchema", () => {
		it("should validate valid config", () => {
			const config = NatsConfigSchema.parse({
				natsUrl: "nats://localhost:4222",
			});

			expect(config.natsUrl).toBe("nats://localhost:4222");
			expect(config.natsStream).toBe("WALLPAPER"); // default
		});
	});

	describe("RedisConfigSchema", () => {
		it("should validate valid config with defaults", () => {
			const config = RedisConfigSchema.parse({});

			expect(config.redisHost).toBe("localhost");
			expect(config.redisPort).toBe(6379);
			expect(config.redisEnabled).toBe(true);
			expect(config.redisPassword).toBeUndefined();
		});

		it("should accept custom values", () => {
			const config = RedisConfigSchema.parse({
				redisHost: "redis.example.com",
				redisPort: 6380,
				redisPassword: "secret",
				redisEnabled: false,
			});

			expect(config.redisHost).toBe("redis.example.com");
			expect(config.redisPort).toBe(6380);
			expect(config.redisPassword).toBe("secret");
			expect(config.redisEnabled).toBe(false);
		});
	});

	describe("OtelConfigSchema", () => {
		it("should validate valid config", () => {
			const config = OtelConfigSchema.parse({
				otelEndpoint: "http://localhost:4318",
				otelServiceName: "my-service",
			});

			expect(config.otelEndpoint).toBe("http://localhost:4318");
			expect(config.otelServiceName).toBe("my-service");
		});

		it("should reject empty service name", () => {
			expect(() =>
				OtelConfigSchema.parse({
					otelEndpoint: "http://localhost:4318",
					otelServiceName: "",
				}),
			).toThrow();
		});
	});
});

describe("Environment Parsing Utilities", () => {
	describe("parseIntEnv", () => {
		it("should parse valid integer", () => {
			expect(parseIntEnv("42")).toBe(42);
			expect(parseIntEnv("0")).toBe(0);
			expect(parseIntEnv("-5")).toBe(-5);
		});

		it("should return default for undefined", () => {
			expect(parseIntEnv(undefined, 10)).toBe(10);
			expect(parseIntEnv(undefined)).toBeUndefined();
		});

		it("should return default for empty string", () => {
			expect(parseIntEnv("", 10)).toBe(10);
		});

		it("should return default for invalid string", () => {
			expect(parseIntEnv("abc", 10)).toBe(10);
			expect(parseIntEnv("12.5", 10)).toBe(12); // parseInt behavior
		});
	});

	describe("parseBoolEnv", () => {
		it("should parse truthy values", () => {
			expect(parseBoolEnv("true")).toBe(true);
			expect(parseBoolEnv("TRUE")).toBe(true);
			expect(parseBoolEnv("1")).toBe(true);
			expect(parseBoolEnv("yes")).toBe(true);
			expect(parseBoolEnv("YES")).toBe(true);
		});

		it("should parse falsy values", () => {
			expect(parseBoolEnv("false")).toBe(false);
			expect(parseBoolEnv("FALSE")).toBe(false);
			expect(parseBoolEnv("0")).toBe(false);
			expect(parseBoolEnv("no")).toBe(false);
			expect(parseBoolEnv("NO")).toBe(false);
		});

		it("should return default for undefined", () => {
			expect(parseBoolEnv(undefined)).toBe(false);
			expect(parseBoolEnv(undefined, true)).toBe(true);
		});

		it("should return default for empty string", () => {
			expect(parseBoolEnv("", true)).toBe(true);
		});

		it("should return default for unknown values", () => {
			expect(parseBoolEnv("maybe", true)).toBe(true);
			expect(parseBoolEnv("maybe", false)).toBe(false);
		});
	});

	describe("getEnv", () => {
		beforeEach(() => {
			process.env.TEST_VAR = "test-value";
		});

		afterEach(() => {
			delete process.env.TEST_VAR;
		});

		it("should get existing environment variable", () => {
			expect(getEnv("TEST_VAR")).toBe("test-value");
		});

		it("should return default for missing variable", () => {
			expect(getEnv("NONEXISTENT", "default")).toBe("default");
		});

		it("should return undefined for missing variable without default", () => {
			expect(getEnv("NONEXISTENT")).toBeUndefined();
		});
	});

	describe("requireEnv", () => {
		beforeEach(() => {
			process.env.REQUIRED_VAR = "required-value";
		});

		afterEach(() => {
			delete process.env.REQUIRED_VAR;
		});

		it("should get existing environment variable", () => {
			expect(requireEnv("REQUIRED_VAR")).toBe("required-value");
		});

		it("should throw for missing variable", () => {
			expect(() => requireEnv("NONEXISTENT")).toThrow(
				"Missing required environment variable: NONEXISTENT",
			);
		});

		it("should throw for empty variable", () => {
			process.env.EMPTY_VAR = "";
			expect(() => requireEnv("EMPTY_VAR")).toThrow(
				"Missing required environment variable: EMPTY_VAR",
			);
			delete process.env.EMPTY_VAR;
		});
	});
});

describe("Config Composition Utilities", () => {
	describe("createConfigLoader", () => {
		const TestSchema = z.object({
			port: z.number().default(3000),
			name: z.string(),
		});

		it("should load config from env mapper", () => {
			const loader = createConfigLoader(TestSchema, () => ({
				port: 8080,
				name: "test-service",
			}));

			const config = loader();
			expect(config.port).toBe(8080);
			expect(config.name).toBe("test-service");
		});

		it("should apply overrides", () => {
			const loader = createConfigLoader(TestSchema, () => ({
				port: 8080,
				name: "test-service",
			}));

			const config = loader({ overrides: { port: 9000 } });
			expect(config.port).toBe(9000);
			expect(config.name).toBe("test-service");
		});

		it("should skip validation when requested", () => {
			const loader = createConfigLoader(TestSchema, () => ({
				port: "not-a-number" as unknown as number,
				name: "test",
			}));

			// Should not throw with skipValidation
			const config = loader({ skipValidation: true });
			expect(config.port).toBe("not-a-number");
		});

		it("should validate by default", () => {
			const loader = createConfigLoader(TestSchema, () => ({
				port: "not-a-number" as unknown as number,
				name: "test",
			}));

			expect(() => loader()).toThrow();
		});
	});

	describe("schema composition via spread", () => {
		it("should compose schemas using spread on .shape", () => {
			// This is the recommended pattern for composing config schemas
			const ComposedSchema = z.object({
				...ServerConfigSchema.shape,
				...RedisConfigSchema.shape,
				// Add service-specific fields
				customField: z.string().default("custom"),
			});

			const result = ComposedSchema.parse({
				port: 8080,
				nodeEnv: "production",
				redisHost: "redis.local",
			});

			expect(result.port).toBe(8080);
			expect(result.nodeEnv).toBe("production");
			expect(result.redisHost).toBe("redis.local");
			expect(result.redisPort).toBe(6379); // default
			expect(result.customField).toBe("custom"); // default
		});
	});
});
