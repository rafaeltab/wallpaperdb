import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { inject, singleton } from "tsyringe";
import type { Config } from "../config.js";
import { BaseConnection } from "./base/base-connection.js";

@singleton()
export class OpenTelemetryConnection extends BaseConnection<NodeSDK> {
    constructor(@inject("config") config: Config) {
        super(config);
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
                exportIntervalMillis: 60000, // Export every 60 seconds
            }),
            instrumentations: [
                getNodeAutoInstrumentations({
                    "@opentelemetry/instrumentation-fs": {
                        enabled: false, // Too noisy for file operations
                    },
                }),
            ],
        });

        sdk.start();
        console.log("OpenTelemetry initialized");

        return sdk;
    }

    protected async closeClient(client: NodeSDK): Promise<void> {
        await client.shutdown();
        console.log("OpenTelemetry shut down");
    }

    async checkHealth(): Promise<boolean> {
        // OTEL doesn't have a direct health check
        // We assume it's healthy if it's initialized
        return true;
    }
}

