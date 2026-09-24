import cors from '@fastify/cors';
import { registerOpenAPI } from '@wallpaperdb/core/openapi';
import { Context, Effect, FiberSet, Layer, ManagedRuntime } from 'effect';
import Fastify, { type FastifyInstance } from 'fastify';
import { Availability } from '../availability/index.js';

export interface ConnectionsState {
  isShuttingDown: boolean;
  connectionsInitialized: boolean;
}
declare module 'fastify' {
  interface FastifyInstance {
    connectionsState: ConnectionsState;
  }
}
export interface HttpConfig {
  readonly nodeEnv: 'development' | 'production' | 'test';
  readonly port: number;
}
function problem(status: number, name: string, title: string) {
  return {
    type: `https://github.com/rafaeltab/wallpaperdb/blob/main/docs/problems/${name}.md`,
    title,
    status,
  };
}
interface HttpExecution {
  run<A, E>(effect: Effect.Effect<A, E, Availability>): Promise<A>;
}
const HttpExecution = Context.Service<HttpExecution>('wallpaperdb.color-extractor.http.Execution');
const executionLayer = Layer.effect(
  HttpExecution,
  Effect.gen(function* () {
    yield* Availability;
    const fibers = yield* FiberSet.make();
    const run = yield* FiberSet.runtimePromise(fibers)<Availability>();
    return { run };
  })
);
export async function createHttpApp<E>(
  config: HttpConfig,
  services: Layer.Layer<Availability, E>,
  options: { readonly logger?: boolean; readonly signal?: AbortSignal } = {}
): Promise<FastifyInstance> {
  const runtime = ManagedRuntime.make(executionLayer.pipe(Layer.provide(services)));
  const app = Fastify({
    logger: options.logger ?? false,
    forceCloseConnections: true,
    requestTimeout: 10000,
    connectionTimeout: 10000,
  });
  app.decorate('connectionsState', { isShuttingDown: false, connectionsInitialized: false });
  app.addHook('preClose', async () => {
    app.connectionsState.isShuttingDown = true;
  });
  app.addHook('onClose', () => runtime.dispose());
  app.setNotFoundHandler((_request, reply) =>
    reply
      .code(404)
      .type('application/problem+json')
      .send(problem(404, 'not-found', 'Not found'))
  );
  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error }, 'Color extractor request failed');
    return reply
      .code(500)
      .type('application/problem+json')
      .send(problem(500, 'generic-server', 'Internal server error'));
  });
  try {
    const { run } = await runtime.runPromise(HttpExecution, { signal: options.signal });
    await app.register(cors, {
      origin:
        config.nodeEnv === 'development'
          ? [/^https?:\/\/localhost:\d+$/, /^https?:\/\/127\.0\.0\.1:\d+$/]
          : false,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      credentials: true,
    });
    await registerOpenAPI(app, {
      title: 'WallpaperDB Color Extractor API',
      version: '1.0.0',
      description: 'Extracts color histograms from stored wallpaper images.',
      servers:
        config.nodeEnv === 'production'
          ? undefined
          : [{ url: `http://localhost:${config.port}`, description: 'Local development server' }],
    });
    app.get(
      '/health',
      { schema: { summary: 'Dependency health', tags: ['Health'] } },
      async (_request, reply) => {
        const result = await run(
          Availability.use((service) => service.health(app.connectionsState.isShuttingDown))
        );
        if (result.status === 'healthy') return result;
        return reply
          .code(503)
          .type('application/problem+json')
          .send({
            ...result,
            ...problem(503, 'service-unavailable', 'Service unavailable'),
            healthStatus: result.status,
          });
      }
    );
    app.get(
      '/ready',
      { schema: { summary: 'Readiness', tags: ['Health'] } },
      async (_request, reply) => {
        const result = await run(
          Availability.use((service) =>
            service.ready(
              app.connectionsState.isShuttingDown,
              app.connectionsState.connectionsInitialized
            )
          )
        );
        if (result.ready) return result;
        return reply
          .code(503)
          .type('application/problem+json')
          .send({ ...problem(503, 'service-unavailable', 'Service unavailable'), ...result });
      }
    );
    await app.ready();
    app.connectionsState.connectionsInitialized = true;
    return app;
  } catch (error) {
    await app.close().catch(() => undefined);
    await runtime.dispose();
    throw error;
  }
}
