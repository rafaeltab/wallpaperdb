import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { BaseConnection } from "./base/base-connection.js";
import type { OtelConfig } from "./types.js";

export interface OtelConnectionOptions {
    /** Metric export interval in ms (default: 60000) */
    metricExportIntervalMs?: number;
    /** Disable file system instrumentation (default: true - too noisy) */
    disableFsInstrumentation?: boolean;
    /** Log messages during initialization/shutdown (default: true) */
    enableLogging?: boolean;
}

/**
 * OpenTelemetry connection manager for WallpaperDB services.
 *
 * Provides a singleton-based OTEL setup that can be used with dependency injection.
 * Uses the shared `withSpan()` utilities from `@wallpaperdb/core/telemetry` for
 * proper span nesting.
 *
 * @example
 * ```typescript
 * // With TSyringe DI
 * container.register('config', { useValue: config });
 * const otel = container.resolve(OtelConnection);
 * await otel.initialize();
 *
 * // Without DI
 * const otel = new OtelConnection(config);
 * await otel.initialize();
 * ```
 */
export class OtelConnection extends BaseConnection<NodeSDK, OtelConfig> {
    private options: OtelConnectionOptions;

    constructor(config: OtelConfig, options: OtelConnectionOptions = {}) {
        super(config);
        this.options = {
            metricExportIntervalMs: 60000,
            disableFsInstrumentation: true,
            enableLogging: true,
            ...options,
        };
    }

    protected createClient(): NodeSDK {
        const traceExporter = new OTLPTraceExporter({
            url: `${this.config.otelEndpoint}/v1/traces`,
        });

        const metricExporter = new OTLPMetricExporter({
            url: `${this.config.otelEndpoint}/v1/metrics`,
        });

        const sdk = new NodeSDK({
            serviceName: this.config.otelServiceName,
            traceExporter,
            metricReader: new PeriodicExportingMetricReader({
                exporter: metricExporter,
                exportIntervalMillis: this.options.metricExportIntervalMs,
            }),
            instrumentations: [
                getNodeAutoInstrumentations({
                    "@opentelemetry/instrumentation-fs": {
                        enabled: !this.options.disableFsInstrumentation,
                    },
                }),
            ],
        });

        sdk.start();

        if (this.options.enableLogging) {
            console.log("OpenTelemetry initialized");
        }

        return sdk;
    }

    protected async closeClient(client: NodeSDK): Promise<void> {
        await client.shutdown();

        if (this.options.enableLogging) {
            console.log("OpenTelemetry shut down");
        }
    }

    async checkHealth(): Promise<boolean> {
        // OTEL doesn't have a direct health check
        // We assume it's healthy if it's initialized
        return this.isInitialized();
    }
}
