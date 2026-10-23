import cors from '@fastify/cors';
import * as OtelTracer from '@effect/opentelemetry/OtelTracer';
import { context, propagation, trace } from '@opentelemetry/api';
import { STATUS_CODES, type IncomingHttpHeaders } from 'node:http';
import { registerOpenAPI } from '@wallpaperdb/core/openapi';
import { Context, Effect, FiberSet, Layer, ManagedRuntime, Schema } from 'effect';
import Fastify, { type FastifyInstance } from 'fastify';
import { Availability } from '../capabilities/availability/index.js';
import { AssetDelivery } from '../capabilities/delivery/index.js';
import { registerDeliveryRoutes } from './delivery.js';
import { registerAuthorRoutes, type AuthorExecution as AuthorExecutionPort } from './authors.js';
import { AuthorAuthentication } from '../adapters/authors/index.js';
import { Lifecycle } from '../capabilities/lifecycle/index.js';
import { tracingLayer } from '../runtime.js';
import { Sources } from '../capabilities/sources/index.js';
import { registerSourceRoutes, type SourceExecution as SourceExecutionPort } from './sources.js';

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
const isTransportError = Schema.is(
  Schema.Struct({ code: Schema.String, statusCode: Schema.Number })
);
const unavailableFields = {
  status: { type: 'integer', enum: [503] },
  timestamp: { type: 'string' },
};
const unavailableRequired = ['type', 'title', 'status', 'timestamp'];
function problem(status: number, name: string, title: string) {
  return {
    type: `https://github.com/rafaeltab/wallpaperdb/blob/main/docs/problems/${name}.md`,
    title,
    status,
  };
}
interface HttpExecution {
  run<A, E>(
    effect: Effect.Effect<A, E, Availability | AssetDelivery>,
    headers: IncomingHttpHeaders,
    signal?: AbortSignal
  ): Promise<A>;
}
const HttpExecution = Context.Service<HttpExecution>('wallpaperdb.asset.http.Execution');
const executionLayer = Layer.effect(
  HttpExecution,
  Effect.gen(function* () {
    yield* Availability;
    yield* AssetDelivery;
    const fibers = yield* FiberSet.make();
    const run = yield* FiberSet.runtimePromise(fibers)<Availability | AssetDelivery>();
    return {
      run: <A, E>(
        effect: Effect.Effect<A, E, Availability | AssetDelivery>,
        headers: IncomingHttpHeaders,
        signal?: AbortSignal
      ) => {
        const active = context.active();
        const parent = (
          trace.getSpan(active) ?? trace.getSpan(propagation.extract(active, headers))
        )?.spanContext();
        return run(parent ? OtelTracer.withSpanContext(effect, parent) : effect, { signal });
      },
    };
  })
);
const AuthorExecution = Context.Service<AuthorExecutionPort>('asset/http/AuthorExecution');
const authorExecutionLayer = Layer.effect(
  AuthorExecution,
  Effect.gen(function* () {
    yield* AuthorAuthentication;
    yield* Lifecycle;
    const fibers = yield* FiberSet.make();
    const run = yield* FiberSet.runtimePromise(fibers)<AuthorAuthentication | Lifecycle>();
    return {
      run: <A, E>(
        effect: Effect.Effect<A, E, AuthorAuthentication | Lifecycle>,
        headers: IncomingHttpHeaders,
        signal?: AbortSignal
      ) => {
        const parent = trace.getSpan(propagation.extract(context.active(), headers))?.spanContext();
        return run(parent ? OtelTracer.withSpanContext(effect, parent) : effect, { signal });
      },
    };
  })
);
const SourceExecution = Context.Service<SourceExecutionPort>('asset/http/SourceExecution');
const sourceExecutionLayer = Layer.effect(
  SourceExecution,
  Effect.gen(function* () {
    yield* AuthorAuthentication;
    yield* Sources;
    const fibers = yield* FiberSet.make();
    const run = yield* FiberSet.runtimePromise(fibers)<AuthorAuthentication | Sources>();
    return {
      run: <A, E>(
        effect: Effect.Effect<A, E, AuthorAuthentication | Sources>,
        headers: IncomingHttpHeaders,
        signal?: AbortSignal
      ) => {
        const parent = trace.getSpan(propagation.extract(context.active(), headers))?.spanContext();
        return run(parent ? OtelTracer.withSpanContext(effect, parent) : effect, { signal });
      },
    };
  })
);
export async function createHttpApp<E, EAuthor = never, ESource = never>(
  config: HttpConfig,
  services: Layer.Layer<Availability | AssetDelivery, E>,
  options: {
    readonly logger?: boolean;
    readonly signal?: AbortSignal;
    readonly shutdownTimeoutMs?: number;
    readonly authorServices?: Layer.Layer<AuthorAuthentication | Lifecycle, EAuthor>;
    readonly sourceServices?: Layer.Layer<AuthorAuthentication | Sources, ESource>;
  } = {}
): Promise<FastifyInstance> {
  const authorExecution = options.authorServices
    ? authorExecutionLayer.pipe(Layer.provide(options.authorServices))
    : Layer.succeed(AuthorExecution, {
        run: () => Promise.reject(new Error('Author services are not configured')),
      });
  const sourceExecution = options.sourceServices
    ? sourceExecutionLayer.pipe(Layer.provide(options.sourceServices))
    : Layer.succeed(SourceExecution, {
        run: () => Promise.reject(new Error('Sources are not configured')),
      });
  const graph = Layer.mergeAll(
    executionLayer.pipe(Layer.provide(services)),
    authorExecution,
    sourceExecution
  ).pipe(Layer.provide(tracingLayer));
  const runtime = ManagedRuntime.make(graph);
  const app = Fastify({
    logger: options.logger ?? false,
    forceCloseConnections: 'idle',
    requestTimeout: 10000,
    connectionTimeout: 10000,
  });
  app.decorate('connectionsState', { isShuttingDown: false, connectionsInitialized: false });
  let shutdownDeadline: ReturnType<typeof setTimeout> | undefined;
  app.addHook('preClose', async () => {
    app.connectionsState.isShuttingDown = true;
    shutdownDeadline = setTimeout(
      () => app.server.closeAllConnections(),
      options.shutdownTimeoutMs ?? 5000
    );
    shutdownDeadline.unref();
  });
  app.addHook('onClose', async () => {
    clearTimeout(shutdownDeadline);
    await runtime.dispose();
  });
  app.setNotFoundHandler((_request, reply) =>
    reply
      .code(404)
      .type('application/problem+json')
      .send(problem(404, 'not-found', 'Not found'))
  );
  app.setErrorHandler((error, request, reply) => {
    reply.header('Cache-Control', 'no-store');
    reply.removeHeader('Content-Length');
    if (
      isTransportError(error) &&
      Object.hasOwn(Fastify.errorCodes, error.code) &&
      Number.isInteger(error.statusCode) &&
      error.statusCode >= 400 &&
      error.statusCode < 500
    ) {
      return reply
        .code(error.statusCode)
        .type('application/problem+json')
        .send(
          problem(
            error.statusCode,
            'invalid-request',
            STATUS_CODES[error.statusCode] ?? 'Invalid request'
          )
        );
    }
    request.log.error({ err: error }, 'Asset request failed');
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
      allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Correlation-ID'],
      credentials: true,
    });
    await registerOpenAPI(app, {
      title: 'WallpaperDB Asset API',
      securitySchemes: { ownerSession: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
      version: '1.0.0',
      description: 'Delivers original and resized wallpapers and current Profile pictures.',
      servers:
        config.nodeEnv === 'production'
          ? undefined
          : [{ url: `http://localhost:${config.port}`, description: 'Local development server' }],
    });
    app.get(
      '/health',
      {
        schema: {
          summary: 'Dependency health',
          tags: ['Health'],
          response: {
            200: { $ref: 'HealthResponse#' },
            503: {
              description: 'Service is degraded, unhealthy, or shutting down',
              content: {
                'application/problem+json': {
                  schema: {
                    allOf: [
                      { $ref: 'ProblemDetails#' },
                      {
                        type: 'object',
                        required: [...unavailableRequired, 'healthStatus', 'checks'],
                        properties: {
                          ...unavailableFields,
                          healthStatus: {
                            type: 'string',
                            enum: ['degraded', 'unhealthy', 'shutting_down'],
                          },
                          checks: { type: 'object', additionalProperties: { type: 'boolean' } },
                          totalDurationMs: { type: 'number' },
                        },
                      },
                    ],
                  },
                },
              },
            },
          },
        },
      },
      async (request, reply) => {
        const result = await run(
          Availability.use((service) => service.health(app.connectionsState.isShuttingDown)),
          request.headers
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
      {
        schema: {
          summary: 'Readiness',
          tags: ['Health'],
          response: {
            200: { $ref: 'ReadyResponse#' },
            503: {
              description: 'Service is not initialized or is shutting down',
              content: {
                'application/problem+json': {
                  schema: {
                    allOf: [
                      { $ref: 'ProblemDetails#' },
                      {
                        type: 'object',
                        required: [...unavailableRequired, 'ready', 'reason'],
                        properties: {
                          ...unavailableFields,
                          ready: { type: 'boolean', enum: [false] },
                          reason: { type: 'string' },
                        },
                      },
                    ],
                  },
                },
              },
            },
          },
        },
      },
      async (request, reply) => {
        const result = await run(
          Availability.use((service) =>
            service.ready(
              app.connectionsState.isShuttingDown,
              app.connectionsState.connectionsInitialized
            )
          ),
          request.headers
        );
        if (result.ready) return result;
        return reply
          .code(503)
          .type('application/problem+json')
          .send({ ...problem(503, 'service-unavailable', 'Service unavailable'), ...result });
      }
    );
    registerDeliveryRoutes(app, run);
    if (options.sourceServices)
      registerSourceRoutes(app, await runtime.runPromise(SourceExecution));
    else
      registerAuthorRoutes(
        app,
        options.authorServices ? await runtime.runPromise(AuthorExecution) : undefined
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
