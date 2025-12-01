import {
    type AddMethodsType,
    BaseTesterBuilder,
    type OpenSearchConfig,
    type OpenSearchTesterBuilder,
    NatsTesterBuilder,
} from "@wallpaperdb/test-utils";
import type { FastifyInstance } from "fastify";
import { container } from "tsyringe";
import { createApp } from "../../src/app.js";
import type { Config } from "../../src/config.js";
import { IndexManagerService } from "../../src/services/index-manager.service.js";

/**
 * Options for InProcessGatewayMixin
 */
export interface InProcessGatewayOptions {
    /** Config overrides */
    configOverrides?: Partial<Config>;
    /** Enable Fastify logger (default: false) */
    logger?: boolean;
}

/**
 * Mixin that creates an in-process Fastify app for the Gateway service.
 */
export class InProcessGatewayTesterBuilder extends BaseTesterBuilder<
    "InProcessGateway",
    [OpenSearchTesterBuilder, NatsTesterBuilder]
> {
    readonly name = "InProcessGateway" as const;
    private options: InProcessGatewayOptions;

    constructor(options: InProcessGatewayOptions = {}) {
        super();
        this.options = options;
    }

    addMethods<
        TBase extends AddMethodsType<[OpenSearchTesterBuilder, NatsTesterBuilder]>,
    >(Base: TBase) {
        const options = this.options;

        return class extends Base {
            private app: FastifyInstance | null = null;
            private _appInitialized = false;

            withGatewayEnvironment() {
                this.addSetupHook(async () => {
                    console.log("[InProcessGateway] Setting up environment variables");
                    const opensearch: OpenSearchConfig | undefined =
                        this.opensearch.tryGetConfig();
                    const nats = this.getNats();

                    if (!opensearch || !nats) {
                        throw new Error(
                            "InProcessGatewayTesterBuilder requires opensearch and nats",
                        );
                    }

                    console.log("Creating in-process Fastify app...");

                    // Set environment variables for loadConfig()
                    process.env.NODE_ENV = "test";
                    process.env.OPENSEARCH_URL = opensearch.endpoint.fromHost;
                    process.env.OPENSEARCH_INDEX = "test_wallpapers";
                    process.env.OPENSEARCH_PASSWORD = opensearch.password;
                    process.env.OPENSEARCH_USERNAME = opensearch.username;
                    process.env.NATS_URL = nats.endpoints.fromHost; // Placeholder for now
                    process.env.NATS_STREAM = nats.streams[0];
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

                    console.log("[InProcessGateway] Environment variables set up");
                });
                return this;
            }

            /**
             * Enable in-process Fastify app creation during setup.
             */
            withInProcessApp() {
                if (this._appInitialized) {
                    return this; // Already registered
                }

                this._appInitialized = true;
                this.withGatewayEnvironment();

                this.addSetupHook(async () => {
                    console.log("[InProcessGateway] Creating app via setup hook");

                    // Import config at runtime to pick up environment variables
                    const { loadConfig } = await import("../../src/config.js");
                    const config = loadConfig();
                    container.registerInstance("config", config);

                    // Create Fastify app
                    this.app = await createApp(config, {
                        logger: options.logger ?? false,
                        enableOtel: false,
                    });

                    await container.resolve(IndexManagerService).createIndex();

                    console.log("In-process Fastify app ready");
                });

                this.addDestroyHook(async () => {
                    if (this.app) {
                        console.log("Closing in-process Fastify app...");
                        await container.resolve(IndexManagerService).deleteIndex();
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
