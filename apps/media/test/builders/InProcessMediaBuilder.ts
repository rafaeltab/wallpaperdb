import {
	type AddMethodsType,
	BaseTesterBuilder,
	type MinioTesterBuilder,
	type NatsTesterBuilder,
	type PostgresTesterBuilder,
} from "@wallpaperdb/test-utils";
import type { FastifyInstance } from "fastify";
import { container } from "tsyringe";
import { createApp } from "../../src/app.js";
import type { Config } from "../../src/config.js";

/**
 * Options for InProcessMediaMixin
 */
export interface InProcessMediaOptions {
	/** Config overrides (e.g., resize limits) */
	configOverrides?: Partial<Config>;
	/** Enable Fastify logger (default: false) */
	logger?: boolean;
}

/**
 * Mixin that creates an in-process Fastify app for the Media service.
 * This is ideal for integration tests that don't require Docker containers.
 *
 * @example
 * ```typescript
 * const tester = await createTesterBuilder()
 *   .with(DockerTesterBuilder)
 *   .with(PostgresTesterBuilder)
 *   .with(MinioTesterBuilder)
 *   .with(NatsTesterBuilder)
 *   .with(MediaMigrationsTesterBuilder)
 *   .with(InProcessMediaTesterBuilder)
 *   .build();
 *
 * const app = tester.getApp();
 * const response = await app.inject({ method: 'GET', url: '/health' });
 * ```
 */
export class InProcessMediaTesterBuilder extends BaseTesterBuilder<
	"InProcessMedia",
	[PostgresTesterBuilder, MinioTesterBuilder, NatsTesterBuilder]
> {
	readonly name = "InProcessMedia" as const;
	private options: InProcessMediaOptions;

	constructor(options: InProcessMediaOptions = {}) {
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
			app: FastifyInstance | null = null;
			_appInitialized = false;

			withMediaEnvironment() {
				this.addSetupHook(async () => {
					console.log("[InProcessMedia] Setting up environment variables");
					const postgres = this.getPostgres();
					const minio = this.getMinio();
					const nats = this.getNats();

					if (!postgres || !minio || !nats) {
						throw new Error(
							"InProcessMediaTesterBuilder requires PostgresTesterBuilder, MinioTesterBuilder, and NatsTesterBuilder",
						);
					}

					console.log("Creating in-process Fastify app for Media service...");

					// Set environment variables for loadConfig()
					process.env.NODE_ENV = "test";
					process.env.PORT = "3002"; // Different port from ingestor
					process.env.DATABASE_URL = postgres.connectionStrings.fromHost;
					process.env.S3_ENDPOINT = minio.endpoints.fromHost;
					process.env.S3_ACCESS_KEY_ID = minio.options.accessKey;
					process.env.S3_SECRET_ACCESS_KEY = minio.options.secretKey;
					process.env.S3_BUCKET =
						minio.buckets.length > 0 ? minio.buckets[0] : "wallpapers";
					process.env.NATS_URL = nats.endpoints.fromHost;
					process.env.NATS_STREAM =
						nats.streams.length > 0 ? nats.streams[0] : "WALLPAPER";
					process.env.OTEL_EXPORTER_OTLP_ENDPOINT =
						"http://localhost:4318/v1/traces";

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

					console.log("[InProcessMedia] Environment variables set up");
				});
				return this;
			}

			/**
			 * Enable in-process Fastify app creation during setup.
			 * The app will be created after all infrastructure is ready.
			 */
			withInProcessApp() {
				if (this._appInitialized) {
					return this; // Already registered
				}

				this._appInitialized = true;
				this.withMediaEnvironment();

				this.addSetupHook(async () => {
					console.log("[InProcessMedia] Creating app via setup hook");

					// Import config at runtime to pick up environment variables
					const { loadConfig } = await import("../../src/config.js");
					const config = loadConfig();
					container.registerInstance("config", config);

					// Create Fastify app
					this.app = await createApp(config, {
						logger: options.logger ?? false,
						enableOtel: false,
					});

					console.log("In-process Media Fastify app ready");
				});

				this.addDestroyHook(async () => {
					if (this.app) {
						console.log("Closing in-process Media Fastify app...");
						await this.app.close();
						this.app = null;
					}
				});

				return this;
			}

			/**
			 * Get the Fastify app instance
			 */
			getApp(): FastifyInstance {
				if (!this.app) {
					throw new Error(
						"App not initialized. Did you call withInProcessApp() and setup() first?",
					);
				}
				return this.app;
			}
		};
	}
}
