import type { FastifyInstance } from "fastify";
import {
	BaseTesterBuilder,
	type PostgresTesterBuilder,
	type MinioTesterBuilder,
	type NatsTesterBuilder,
	type AddMethodsType,
} from "@wallpaperdb/test-utils";
import { createApp } from "../../src/app.js";
import type { Config } from "../../src/config.js";

/**
 * Options for InProcessIngestorMixin
 */
export interface InProcessIngestorOptions {
	/** Config overrides (e.g., rate limits, reconciliation intervals) */
	configOverrides?: Partial<Config>;
	/** Enable Fastify logger (default: false) */
	logger?: boolean;
}

/**
 * Mixin that creates an in-process Fastify app for the Ingestor service.
 * This is ideal for integration tests that don't require Docker containers.
 *
 * @example
 * ```typescript
 * const tester = await createTesterBuilder()
 *   .with(DockerTesterBuilder)
 *   .with(PostgresTesterBuilder)
 *   .with(MinioTesterBuilder)
 *   .with(NatsTesterBuilder)
 *   .with(IngestorMigrationsTesterBuilder)
 *   .with(InProcessIngestorTesterBuilder)
 *   .build();
 *
 * const app = tester.getApp();
 * const response = await app.inject({ method: 'GET', url: '/health' });
 * ```
 */
export class InProcessIngestorTesterBuilder extends BaseTesterBuilder<
	"InProcessIngestor",
	[PostgresTesterBuilder, MinioTesterBuilder, NatsTesterBuilder]
> {
	readonly name = "InProcessIngestor" as const;
	private options: InProcessIngestorOptions;
	private app: FastifyInstance | null = null;

	constructor(options: InProcessIngestorOptions = {}) {
		super();
		this.options = options;
	}

	addMethods<
		TBase extends AddMethodsType<
			[PostgresTesterBuilder, MinioTesterBuilder, NatsTesterBuilder]
		>,
	>(Base: TBase) {
		const options = this.options;

		return class extends Base {
			private app: FastifyInstance | null = null;

			override async setup(): Promise<void> {
				await super.setup();

				const postgres = this.getPostgres();
				const minio = this.getMinio();
				const nats = this.getNats();

				if (!postgres || !minio || !nats) {
					throw new Error(
						"InProcessIngestorTesterBuilder requires PostgresTesterBuilder, MinioTesterBuilder, and NatsTesterBuilder",
					);
				}

				console.log("Creating in-process Fastify app...");

				// Set environment variables for loadConfig()
				process.env.NODE_ENV = "test";
				process.env.DATABASE_URL = postgres.connectionString;
				process.env.S3_ENDPOINT = minio.endpoint;
				process.env.S3_ACCESS_KEY_ID = minio.options.accessKey;
				process.env.S3_SECRET_ACCESS_KEY = minio.options.secretKey;
				process.env.S3_BUCKET =
					minio.buckets.length > 0 ? minio.buckets[0] : "wallpapers";
				process.env.NATS_URL = nats.endpoint;
				process.env.NATS_STREAM =
					nats.streams.length > 0 ? nats.streams[0] : "WALLPAPERS";
				process.env.OTEL_EXPORTER_OTLP_ENDPOINT =
					"http://localhost:4318/v1/traces";
				process.env.REDIS_ENABLED = "false"; // Disable Redis by default

				// Apply config overrides
				if (options.configOverrides) {
					for (const [key, value] of Object.entries(
						options.configOverrides,
					)) {
						if (value !== undefined) {
							// Convert camelCase to SCREAMING_SNAKE_CASE
							const envKey = key
								.replace(/([A-Z])/g, "_$1")
								.toUpperCase()
								.replace(/^_/, "");
							process.env[envKey] = String(value);
						}
					}
				}

				// Import config at runtime to pick up environment variables
				const { loadConfig } = await import("../../src/config.js");
				const config = loadConfig();

				// Create Fastify app
				this.app = await createApp(config, {
					logger: options.logger ?? false,
					enableOtel: false,
				});

				console.log("In-process Fastify app ready");
			}

			override async destroy(): Promise<void> {
				if (this.app) {
					console.log("Closing in-process Fastify app...");
					await this.app.close();
					this.app = null;
				}
				await super.destroy();
			}

			/**
			 * Get the Fastify app instance
			 */
			getApp(): FastifyInstance {
				if (!this.app) {
					throw new Error(
						"App not initialized. Did you call setup() first?",
					);
				}
				return this.app;
			}
		};
	}
}
