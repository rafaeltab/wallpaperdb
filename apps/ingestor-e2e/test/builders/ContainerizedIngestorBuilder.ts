import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers";
import {
	BaseTesterBuilder,
	type DockerTesterBuilder,
	type PostgresTesterBuilder,
	type MinioTesterBuilder,
	type NatsTesterBuilder,
	type RedisTesterBuilder,
	type AddMethodsType,
} from "@wallpaperdb/test-utils";

/**
 * IMPORTANT: This file is duplicated from apps/ingestor/test/builders/ContainerizedIngestorBuilder.ts
 *
 * WHY DUPLICATED?
 * - The ingestor-e2e package CANNOT import from the main ingestor package (enforced by ESLint)
 * - This architectural constraint prevents accidental "fake" E2E tests that bypass Docker
 * - E2E tests MUST test the actual Docker image, not in-process code
 *
 * MAINTENANCE:
 * - Source of truth: apps/ingestor/test/builders/ContainerizedIngestorBuilder.ts
 * - Changes to core logic should be synchronized between both files
 * - The only difference should be this comment block
 *
 * DO NOT import any application code - only test infrastructure (@wallpaperdb/test-utils is OK)
 */

/**
 * Options for ContainerizedIngestorTesterBuilder
 */
export interface ContainerizedIngestorOptions {
	/** Number of ingestor instances to start */
	instances?: number;
	/** Docker image name (must be built beforehand) */
	image?: string;
	/** Config overrides passed as environment variables */
	config?: Record<string, unknown>;
	/** Enable Redis for distributed rate limiting */
	enableRedis?: boolean;
}

/**
 * Builder that starts the Ingestor service as Docker container(s).
 * This is ideal for E2E tests that require full containerization.
 *
 * @example
 * ```typescript
 * const TesterClass = createTesterBuilder()
 *   .with(DockerTesterBuilder)
 *   .with(PostgresTesterBuilder)
 *   .with(MinioTesterBuilder)
 *   .with(NatsTesterBuilder)
 *   .with(ContainerizedIngestorTesterBuilder)
 *   .build();
 *
 * const tester = new TesterClass();
 * tester
 *   .withNetwork()
 *   .withPostgres((b) => b.withNetworkAlias('postgres'))
 *   .withMinio((b) => b.withNetworkAlias('minio'))
 *   .withNats((b) => b.withNetworkAlias('nats'));
 *
 * await tester.setup();
 * const baseUrl = tester.getBaseUrl();
 * const response = await fetch(`${baseUrl}/health`);
 * ```
 */
export class ContainerizedIngestorTesterBuilder extends BaseTesterBuilder<
	"ContainerizedIngestor",
	[DockerTesterBuilder, PostgresTesterBuilder, MinioTesterBuilder, NatsTesterBuilder]
> {
	readonly name = "ContainerizedIngestor" as const;
	private options: ContainerizedIngestorOptions;
	private containers: StartedTestContainer[] = [];
	private baseUrl: string | null = null;

	constructor(options: ContainerizedIngestorOptions = {}) {
		super();
		this.options = options;
	}

	addMethods<
		TBase extends AddMethodsType<
			[DockerTesterBuilder, PostgresTesterBuilder, MinioTesterBuilder, NatsTesterBuilder]
		>,
	>(Base: TBase) {
		const options = this.options;

		return class extends Base {
			private containers: StartedTestContainer[] = [];
			private baseUrl: string | null = null;
			private _containerizedAppInitialized = false;

			/**
			 * Enable containerized ingestor app creation during setup.
			 * The app containers will be created after all infrastructure is ready.
			 */
			withContainerizedApp() {
				if (this._containerizedAppInitialized) {
					return this; // Already registered
				}
				this._containerizedAppInitialized = true;

				this.addSetupHook(async () => {
					console.log("[ContainerizedIngestor] Starting containers via setup hook");
					const network = this.getNetwork();
					const postgres = this.getPostgres();
					const minio = this.getMinio();
					const nats = this.getNats();

					if (!network || !postgres || !minio || !nats) {
						throw new Error(
							"ContainerizedIngestorTesterBuilder requires DockerTesterBuilder, PostgresTesterBuilder, MinioTesterBuilder, and NatsTesterBuilder",
						);
					}

					// Check for optional Redis
					let redis = null;
					try {
						redis = this.getRedis();
					} catch {
						// Redis is optional
					}

					const instances = options.instances ?? 1;
					const image = options.image ?? "wallpaperdb-ingestor:latest";

					console.log(`Starting ${instances} ingestor container(s)...`);

					for (let i = 0; i < instances; i++) {
						const environment: Record<string, string> = {
							NODE_ENV: "test",
							DATABASE_URL: postgres.connectionString,
							S3_ENDPOINT: minio.endpoint,
							S3_ACCESS_KEY_ID: minio.options.accessKey,
							S3_SECRET_ACCESS_KEY: minio.options.secretKey,
							S3_BUCKET:
								minio.buckets.length > 0 ? minio.buckets[0] : "wallpapers",
							NATS_URL: nats.endpoint,
							NATS_STREAM:
								nats.streams.length > 0 ? nats.streams[0] : "WALLPAPERS",
							OTEL_EXPORTER_OTLP_ENDPOINT: "http://localhost:4318/v1/traces",
							PORT: "3001",
						};

						// Add Redis if enabled
						if (redis && options.enableRedis) {
							environment.REDIS_HOST = redis.host;
							environment.REDIS_PORT = String(redis.port);
							environment.REDIS_ENABLED = "true";
						} else {
							environment.REDIS_ENABLED = "false";
						}

						// Apply custom config overrides
						if (options.config) {
							for (const [key, value] of Object.entries(options.config)) {
								// Convert camelCase to SCREAMING_SNAKE_CASE
								const envKey = key
									.replace(/([A-Z])/g, "_$1")
									.toUpperCase()
									.replace(/^_/, "");
								environment[envKey] = String(value);
							}
						}

						const container = await new GenericContainer(image)
							.withNetwork(network)
							.withNetworkAliases(`ingestor-${i}`)
							.withEnvironment(environment)
							.withExposedPorts(3001)
							.withWaitStrategy(
								Wait.forHttp("/health", 3001)
						.forStatusCode(200)
						.withStartupTimeout(90000),
							)
							.start();

						const host = container.getHost();
						const port = container.getMappedPort(3001);

						console.log(
							`Ingestor instance ${i} started at ${host}:${port}`,
						);

						this.containers.push(container);

						// Set base URL to first instance
						if (i === 0) {
							this.baseUrl = `http://${host}:${port}`;
						}
					}

					console.log(`All ${instances} ingestor instances ready`);
				});

				this.addDestroyHook(async () => {
					if (this.containers.length > 0) {
						console.log("Stopping ingestor containers...");
						await Promise.all(this.containers.map((c) => c.stop()));
						this.containers = [];
					}
				});

				return this;
			}

			/**
			 * Get all ingestor container instances
			 */
			getIngestorContainers(): StartedTestContainer[] {
				if (this.containers.length === 0) {
					throw new Error(
						"Containers not initialized. Did you call withContainerizedApp() and setup() first?",
					);
				}
				return this.containers;
			}

			/**
			 * Get the base URL for the first ingestor instance
			 */
			getBaseUrl(): string {
				if (!this.baseUrl) {
					throw new Error(
						"Base URL not initialized. Did you call withContainerizedApp() and setup() first?",
					);
				}
				return this.baseUrl;
			}
		};
	}
}
