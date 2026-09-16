import { Effect, Layer, Redacted } from 'effect';
import type { FastifyInstance } from 'fastify';
import { availabilityProbeLayer } from './adapters/availability/index.js';
import { NatsProjectionConsumer, natsProjectionLayer } from './adapters/events/index.js';
import { OpenSearchGateway, openSearchLayer } from './adapters/opensearch/index.js';
import { redisQuotaLayer } from './adapters/redis/index.js';
import { admissionLayer } from './admission/index.js';
import { availabilityLayer } from './availability/index.js';
import { catalogueLayer } from './catalogue/index.js';
import type { Config } from './config.js';
import { signedCursorsLayer } from './cursors/index.js';
import { createHttpApp } from './http/index.js';
import { projectionLayer } from './projection/index.js';
import { gatewayTracingLayer } from './runtime.js';

interface AppOptions {
  readonly logger?: boolean;
  readonly enableOtel?: boolean;
  readonly otelHealthy?: boolean;
  readonly shutdownTimeoutMs?: number;
}

/** The one production graph selects implementations and owns shared lifetimes. */
export function gatewayLayer(config: Config, options: AppOptions = {}) {
  const search = openSearchLayer({
    url: config.opensearchUrl,
    username: config.opensearchUsername,
    password:
      config.opensearchPassword === undefined
        ? undefined
        : Redacted.value(config.opensearchPassword),
    wallpaperIndex: config.opensearchIndex,
    profileIndex: config.opensearchProfileIndex,
  });
  const projection = projectionLayer.pipe(Layer.provide(search));
  const consumers = natsProjectionLayer({
    url: config.natsUrl,
    wallpaperStream: config.natsStream,
    shutdownTimeoutMs: options.shutdownTimeoutMs,
  }).pipe(Layer.provide(projection));
  const catalogue = catalogueLayer({ colorSpreadStrategy: config.colorSpreadStrategy }).pipe(
    Layer.provide(
      Layer.mergeAll(
        search,
        signedCursorsLayer({
          secret: Redacted.value(config.cursorSecret),
          expirationMs: config.cursorExpirationMs,
        })
      )
    )
  );
  const admission = admissionLayer({
    enabled: config.rateLimitEnabled,
    limit: config.rateLimitMaxAnonymous,
    windowMs: config.rateLimitWindowMs,
  }).pipe(
    Layer.provide(
      redisQuotaLayer({
        redisEnabled: config.redisEnabled,
        redisHost: config.redisHost,
        redisPort: config.redisPort,
        redisPassword:
          config.redisPassword === undefined ? undefined : Redacted.value(config.redisPassword),
      })
    )
  );
  const probe = Layer.unwrap(
    Effect.gen(function* () {
      const search = yield* OpenSearchGateway;
      const consumers = yield* NatsProjectionConsumer;
      return availabilityProbeLayer({
        opensearch: () => search.check(),
        nats: () => consumers.check(),
        otel: () =>
          Effect.succeed(
            options.enableOtel === false || !config.otelEndpoint || options.otelHealthy === true
          ),
      });
    })
  ).pipe(Layer.provide(Layer.mergeAll(search, consumers)));
  return Layer.mergeAll(catalogue, admission, availabilityLayer.pipe(Layer.provide(probe))).pipe(
    Layer.provide(gatewayTracingLayer)
  );
}

export async function createApp(
  config: Config,
  options: AppOptions = {}
): Promise<FastifyInstance> {
  const app = await createHttpApp(config, gatewayLayer(config, options), options);
  app.connectionsState.connectionsInitialized = true;
  return app;
}
