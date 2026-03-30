import {
    type AddMethodsType,
    BaseTesterBuilder,
    type MinioTesterBuilder,
    type NatsTesterBuilder,
    type PostgresTesterBuilder,
    type RedisConfig,
    type RedisTesterBuilder,
} from "@wallpaperdb/test-utils";
import type { FastifyInstance } from "fastify";
import { createApp } from "../../src/app.js";
import type { Config } from "../../src/config.js";
import { container } from "tsyringe";
import { DefaultValidationLimitsService } from "../../src/services/validation-limits.service.js";
import { SystemTimeService } from "../../src/services/core/time.service.js";
import { FakeTimerService } from "@wallpaperdb/core/timer";

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
    [
        PostgresTesterBuilder,
        MinioTesterBuilder,
        NatsTesterBuilder,
        RedisTesterBuilder,
    ]
> {
    readonly name = "InProcessIngestor" as const;
    private options: InProcessIngestorOptions;

    constructor(options: InProcessIngestorOptions = {}) {
        super();
        this.options = options;
    }

    addMethods<
        TBase extends AddMethodsType<
            [
                PostgresTesterBuilder,
                MinioTesterBuilder,
                NatsTesterBuilder,
                RedisTesterBuilder,
            ]
        >,
    >(Base: TBase) {
        const options = this.options;

        return class extends Base {
            app: FastifyInstance | null = null;
            _appInitialized = false;
            /** Set by withFakeTimers() before withInProcessApp() is called */
            _fakeTimer: FakeTimerService | null = null;

            withIngestorEnvironment() {
                this.addSetupHook(async () => {
                    console.log("[InProcessIngestor] Setting up environment variables");
                    const postgres = this.getPostgres();
                    const minio = this.getMinio();
                    const nats = this.getNats();
                    const redis: RedisConfig | undefined = this.redis.tryGetConfig();

                    if (!postgres || !minio || !nats) {
                        throw new Error(
                            "InProcessIngestorTesterBuilder requires PostgresTesterBuilder, MinioTesterBuilder, and NatsTesterBuilder",
                        );
                    }

                    console.log("Creating in-process Fastify app...");

                    // Set environment variables for loadConfig()
                    process.env.NODE_ENV = "test";
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

                    if (redis === undefined) {
                        process.env.REDIS_ENABLED = "false"; // Disable Redis by default
                    } else {
                        process.env.REDIS_HOST = redis.host.fromHost;
                        process.env.REDIS_PORT = redis.port.fromHost;
                        process.env.REDIS_ENABLED = "true";
                        process.env.RATE_LIMIT_MAX = "10";
                        process.env.RATE_LIMIT_WINDOW_MS = "10000";
                    }

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

                    console.log("[InProcessIngestor] Environment variables set up");
                });
                return this;
            }

            /**
             * Opt in to fake timer control for this test session.
             *
             * Must be called **before** `withInProcessApp()`.  After `setup()`
             * completes, retrieve the instance with `getFakeTimer()` and use
             * `fakeTimer.tickAsync(ms)` to advance time deterministically instead of
             * `await wait(ms)`.
             */
            withFakeTimers() {
                this._fakeTimer = new FakeTimerService();
                return this;
            }

            /**
             * Returns the FakeTimerService instance registered via withFakeTimers().
             * Throws if withFakeTimers() was not called first.
             */
            getFakeTimer(): FakeTimerService {
                if (!this._fakeTimer) {
                    throw new Error(
                        "FakeTimerService not set up. Call withFakeTimers() before withInProcessApp().",
                    );
                }
                return this._fakeTimer;
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
                this.withIngestorEnvironment();

                // Capture reference so the hook closure can see it.
                // biome-ignore lint/suspicious/noThisInStatic -- needed to capture instance ref in hook closure
                const self = this;

                this.addSetupHook(async () => {
                    console.log("[InProcessIngestor] Creating app via setup hook");

                    // Import config at runtime to pick up environment variables
                    const { loadConfig } = await import("../../src/config.js");
                    const config = loadConfig();
                    container.registerInstance("config", config);
                    container.registerType(
                        "ValidationLimitsService",
                        DefaultValidationLimitsService,
                    );
                    container.registerType("TimeService", SystemTimeService);

                    // If the test opted into fake timers, override the TimerService
                    // registration that createApp() is about to make.  We register
                    // the fake instance here — createApp() also calls
                    // container.register('TimerService', …) but tsyringe resolves the
                    // *last* registration, so we re-register after createApp() returns.
                    const fakeTimer = self._fakeTimer;

                    // Create Fastify app (registers SystemTimerService internally)
                    this.app = await createApp(config, {
                        logger: options.logger ?? false,
                        enableOtel: false,
                    });

                    // Override with fake timer after createApp() if requested
                    if (fakeTimer) {
                        container.register("TimerService", { useValue: fakeTimer });
                    }

                    console.log("In-process Fastify app ready");
                });

                this.addDestroyHook(async () => {
                    if (this.app) {
                        console.log("Closing in-process Fastify app...");
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
