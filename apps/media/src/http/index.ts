import cors from '@fastify/cors';
import * as OtelTracer from '@effect/opentelemetry/OtelTracer';
import { context, propagation, trace } from '@opentelemetry/api';
import { STATUS_CODES, type IncomingHttpHeaders } from 'node:http';
import { registerOpenAPI } from '@wallpaperdb/core/openapi';
import { Context, Effect, FiberSet, Layer, ManagedRuntime, Schema } from 'effect';
import Fastify, { type FastifyInstance } from 'fastify';
import { Availability } from '../availability/index.js';
import { MediaDelivery } from '../delivery/index.js';
import { registerDeliveryRoutes } from './delivery.js';

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
    effect: Effect.Effect<A, E, Availability | MediaDelivery>,
    headers: IncomingHttpHeaders,
    signal?: AbortSignal
  ): Promise<A>;
}
const HttpExecution = Context.Service<HttpExecution>('wallpaperdb.media.http.Execution');
const executionLayer = Layer.effect(
  HttpExecution,
  Effect.gen(function* () {
    yield* Availability;
    yield* MediaDelivery;
    const fibers = yield* FiberSet.make();
    const run = yield* FiberSet.runtimePromise(fibers)<Availability | MediaDelivery>();
    return {
      run: <A, E>(
        effect: Effect.Effect<A, E, Availability | MediaDelivery>,
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
export async function createHttpApp<E>(
  config: HttpConfig,
  services: Layer.Layer<Availability | MediaDelivery, E>,
  options: {
    readonly logger?: boolean;
    readonly signal?: AbortSignal;
    readonly shutdownTimeoutMs?: number;
  } = {}
): Promise<FastifyInstance> {
  const runtime = ManagedRuntime.make(executionLayer.pipe(Layer.provide(services)));
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
    request.log.error({ err: error }, 'Media request failed');
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
      title: 'WallpaperDB Media API',
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
    await app.ready();
    app.connectionsState.connectionsInitialized = true;
    return app;
  } catch (error) {
    await app.close().catch(() => undefined);
    await runtime.dispose();
    throw error;
  }
}
