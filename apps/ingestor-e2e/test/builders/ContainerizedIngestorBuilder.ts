import {
    type AddMethodsType,
    BaseTesterBuilder,
    type DockerTesterBuilder,
    type MinioTesterBuilder,
    type NatsTesterBuilder,
    type PostgresTesterBuilder,
    type RedisTesterBuilder,
} from "@wallpaperdb/test-utils";
import {
    GenericContainer,
    type StartedTestContainer,
    Wait,
} from "testcontainers";

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
    [
        DockerTesterBuilder,
        PostgresTesterBuilder,
        MinioTesterBuilder,
        NatsTesterBuilder,
        RedisTesterBuilder,
    ]
> {
    readonly name = "ContainerizedIngestor" as const;
    private options: ContainerizedIngestorOptions;

    constructor(options: ContainerizedIngestorOptions = {}) {
        super();
        this.options = options;
    }

    addMethods<
        TBase extends AddMethodsType<
            [
                DockerTesterBuilder,
                PostgresTesterBuilder,
                MinioTesterBuilder,
                NatsTesterBuilder,
                RedisTesterBuilder,
            ]
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
                    console.log(
                        "[ContainerizedIngestor] Starting containers via setup hook",
                    );
                    const network = this.docker.network;
                    const postgres = this.getPostgres();
                    const minio = this.getMinio();
                    const nats = this.getNats();

                    if (!postgres || !minio || !nats) {
                        throw new Error(
                            "ContainerizedIngestorTesterBuilder requires DockerTesterBuilder, PostgresTesterBuilder, MinioTesterBuilder, and NatsTesterBuilder",
                        );
                    }

                    // Check for optional Redis
                    const redis = this.redis.tryGetConfig();

                    const instances = options.instances ?? 1;
                    const image = options.image ?? "wallpaperdb-ingestor:latest";

                    console.log(`Starting ${instances} ingestor container(s)...`);

                    for (let i = 0; i < instances; i++) {
                        const environment: Record<string, string> = {
                            NODE_ENV: "test",
                            DATABASE_URL: network
                                ? postgres.connectionStrings.networked
                                : postgres.connectionStrings.directIp,
                            S3_ENDPOINT: network
                                ? minio.endpoints.networked
                                : minio.endpoints.directIp,
                            S3_ACCESS_KEY_ID: minio.options.accessKey,
                            S3_SECRET_ACCESS_KEY: minio.options.secretKey,
                            S3_BUCKET:
                                minio.buckets.length > 0 ? minio.buckets[0] : "wallpapers",
                            NATS_URL: network
                                ? nats.endpoints.networked
                                : nats.endpoints.directIp,
                            NATS_STREAM:
                                nats.streams.length > 0 ? nats.streams[0] : "WALLPAPER",
                            OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:4318/v1/traces",
                            PORT: "3001",
                            // Explicitly set fast reconciliation intervals for E2E tests
                            RECONCILIATION_INTERVAL_MS: "1000", // 1 second for E2E tests
                            MINIO_CLEANUP_INTERVAL_MS: "2000", // 2 seconds for E2E tests
                        };

                        // Add Redis if enabled
                        if (redis && options.enableRedis) {
                            environment.REDIS_HOST = network
                                ? redis.host.networked
                                : redis.host.directIp;
                            environment.REDIS_PORT = network
                                ? redis.port.networked
                                : redis.port.directIp;
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

                        const containerDefinition = new GenericContainer(image)
                            .withEnvironment(environment)
                            .withExposedPorts(3001)
                            .withLogConsumer((stream) =>
                                stream
                                    .on("data", (line) =>
                                        console.log(`[Ingestor] ${line}`.trimEnd()),
                                    )
                                    .on("err", (line) =>
                                        console.error(`[Ingestor] ${line}`.trimEnd()),
                                    ),
                            )
                            .withWaitStrategy(
                                Wait.forHttp("/health", 3001)
                                    .forStatusCode(200)
                                    .withStartupTimeout(90000),
                            );

                        if (network !== undefined) {
                            containerDefinition
                                .withNetwork(network)
                                .withNetworkAliases(`ingestor-${i}`);
                        }

                        const container = await containerDefinition.start();

                        const host = container.getHost();
                        const port = container.getMappedPort(3001);

                        console.log(`Ingestor instance ${i} started at ${host}:${port}`);

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
