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
  /**
   * Pre-initialized SDK from otel-init.ts pattern.
   * When provided, the connection wraps the existing SDK instead of creating a new one.
   * The connection will NOT shutdown this SDK on close() (external lifecycle).
   */
  existingSdk?: NodeSDK;
}

/**
 * OpenTelemetry connection manager for WallpaperDB services.
 *
 * Supports two initialization patterns:
 * - **Pattern A**: Create SDK in connection (default)
 * - **Pattern B**: Wrap pre-initialized SDK (via existingSdk option)
 *
 * Pattern B is useful for services that need to initialize OTEL early (before imports)
 * via otel-init.ts, then wrap the SDK in this connection for lifecycle management.
 *
 * @example
 * ```typescript
 * // Pattern A: Create SDK in connection
 * const otel = new OtelConnection(config);
 * await otel.initialize();
 *
 * // Pattern B: Wrap existing SDK
 * const sdk = createOtelSdk(config); // from otel-init.ts
 * const otel = new OtelConnection(config, { existingSdk: sdk });
 * await otel.initialize();
 * ```
 */
export class OtelConnection extends BaseConnection<NodeSDK, OtelConfig> {
  private options: OtelConnectionOptions;
  private readonly isExternalSdk: boolean;

  constructor(config: OtelConfig, options: OtelConnectionOptions = {}) {
    super(config);
    this.options = {
      metricExportIntervalMs: 60000,
      disableFsInstrumentation: true,
      enableLogging: true,
      ...options,
    };
    this.isExternalSdk = !!options.existingSdk;
  }

  protected createClient(): NodeSDK {
    // Pattern B: Wrap existing SDK
    if (this.options.existingSdk) {
      return this.options.existingSdk;
    }

    // Pattern A: Create SDK in connection
    // Default endpoint if not provided (for testing/development)
    const endpoint = this.config.otelEndpoint || "http://localhost:4318";

    const traceExporter = new OTLPTraceExporter({
      url: `${endpoint}/v1/traces`,
    });

    const metricExporter = new OTLPMetricExporter({
      url: `${endpoint}/v1/metrics`,
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
    // Don't shutdown external SDKs (managed by otel-init.ts)
    if (this.isExternalSdk) {
      return;
    }

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
