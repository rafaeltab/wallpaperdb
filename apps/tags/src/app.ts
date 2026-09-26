import { Layer } from 'effect';
import { dependencyProbeLayer } from './adapters/dependencies/index.js';
import { availabilityLayer } from './availability/index.js';
import type { Config } from './config.js';
import { createHttpApp } from './http/index.js';
import { tracingLayer } from './runtime.js';

interface AppOptions {
  readonly logger?: boolean;
  readonly signal?: AbortSignal;
  readonly otelHealthy?: boolean;
  readonly shutdownTimeoutMs?: number;
}
export function tagsLayer(config: Config, options: AppOptions = {}) {
  return availabilityLayer.pipe(
    Layer.provide(
      dependencyProbeLayer({
        databaseUrl: config.databaseUrl,
        natsUrl: config.natsUrl,
        serviceName: config.otelServiceName,
        otelHealthy:
          config.nodeEnv === 'test' || !config.otelEndpoint || options.otelHealthy === true,
      })
    ),
    Layer.provideMerge(tracingLayer)
  );
}
export function createApp(config: Config, options: AppOptions = {}) {
  return createHttpApp(
    { nodeEnv: config.nodeEnv, port: config.port },
    tagsLayer(config, options),
    options
  );
}
