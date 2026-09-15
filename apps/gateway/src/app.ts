import { Effect, Exit, Scope } from 'effect';
import type { FastifyInstance } from 'fastify';
import { createAvailabilityProbe } from './adapters/availability/index.js';
import { createNatsProjectionConsumer } from './adapters/events/index.js';
import { createOpenSearchGateway } from './adapters/opensearch/index.js';
import { createRedisQuota } from './adapters/redis/index.js';
import { createAdmission } from './admission/index.js';
import { createAvailability } from './availability/index.js';
import { createCatalogue } from './catalogue/index.js';
import type { Config } from './config.js';
import { createSignedCursors } from './cursors/index.js';
import { createHttpApp } from './http/index.js';
import { createProjection } from './projection/index.js';
import { runGatewayEffect } from './runtime.js';

interface Resource {
  start(): Promise<void>;
  stop(): Promise<void>;
}
function acquire(resource: Resource) {
  // Register disposal before start, so partially acquired adapters are also closed.
  return Effect.acquireRelease(Effect.succeed(resource), (value) =>
    Effect.promise(() => value.stop())
  ).pipe(Effect.tap((value) => Effect.tryPromise(() => value.start())));
}
export async function createApp(
  config: Config,
  options: { logger?: boolean; enableOtel?: boolean; otelHealthy?: boolean } = {}
): Promise<FastifyInstance> {
  const scope = await Effect.runPromise(Scope.make());
  const search = createOpenSearchGateway({
    url: config.opensearchUrl,
    username: config.opensearchUsername,
    password: config.opensearchPassword,
    wallpaperIndex: config.opensearchIndex,
  });
  const consumers = createNatsProjectionConsumer(
    { url: config.natsUrl, wallpaperStream: config.natsStream },
    createProjection(search.projectionStore)
  );
  const quota = createRedisQuota({
    redisEnabled: config.redisEnabled,
    redisHost: config.redisHost,
    redisPort: config.redisPort,
    redisPassword: config.redisPassword,
  });
  const availability = createAvailability(
    createAvailabilityProbe({
      opensearch: () => search.check(),
      nats: () => consumers.check(),
      otel: async () =>
        options.enableOtel === false || !config.otelEndpoint || options.otelHealthy === true,
    })
  );
  const catalogue = createCatalogue(
    search.read,
    createSignedCursors({ secret: config.cursorSecret, expirationMs: config.cursorExpirationMs }),
    { colorSpreadStrategy: config.colorSpreadStrategy }
  );
  const admission = createAdmission(quota, {
    enabled: config.rateLimitEnabled,
    limit: config.rateLimitMaxAnonymous,
    windowMs: config.rateLimitWindowMs,
  });
  try {
    await runGatewayEffect(
      Effect.gen(function* () {
        yield* acquire(quota);
        yield* acquire(search);
        yield* acquire(consumers);
      }).pipe(Scope.extend(scope))
    );
    const app = await createHttpApp(
      {
        port: config.port,
        nodeEnv: config.nodeEnv,
        mediaServiceUrl: config.mediaServiceUrl,
        mediaPublicBaseUrl: config.mediaPublicBaseUrl,
        mediaPublicPath: config.mediaPublicPath,
        graphqlMaxDepth: config.graphqlMaxDepth,
        graphqlMaxComplexity: config.graphqlMaxComplexity,
        graphqlMaxUniqueFields: config.graphqlMaxUniqueFields,
        graphqlMaxAliases: config.graphqlMaxAliases,
        graphqlMaxBatchSize: config.graphqlMaxBatchSize,
        graphqlIntrospectionEnabled: config.graphqlIntrospectionEnabled,
        rateLimitMaxAnonymous: config.rateLimitMaxAnonymous,
      },
      { catalogue, admission, availability },
      { logger: options.logger }
    );
    app.connectionsState.connectionsInitialized = true;
    app.addHook('onClose', async () => {
      app.connectionsState.isShuttingDown = true;
      await Effect.runPromise(Scope.close(scope, Exit.void));
    });
    return app;
  } catch (error) {
    await Effect.runPromise(Scope.close(scope, Exit.fail(error)));
    throw new Error('Gateway startup failed');
  }
}
