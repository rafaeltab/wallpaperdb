import { type IncomingHttpHeaders, STATUS_CODES } from 'node:http';
import * as OtelTracer from '@effect/opentelemetry/OtelTracer';
import { context, propagation, trace } from '@opentelemetry/api';
import cors from '@fastify/cors';
import { registerOpenAPI } from '@wallpaperdb/core/openapi';
import { Context, Effect, FiberSet, Layer, ManagedRuntime, Schema } from 'effect';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
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

interface HttpExecution {
  readonly interrupt: Effect.Effect<void>;
  run<A, E>(effect: Effect.Effect<A, E, Availability>, headers: IncomingHttpHeaders): Promise<A>;
}
const HttpExecution = Context.Service<HttpExecution>('wallpaperdb.tags.http.Execution');
const executionLayer = Layer.effect(
  HttpExecution,
  Effect.gen(function* () {
    yield* Availability;
    const fibers = yield* FiberSet.make();
    const run = yield* FiberSet.runtimePromise(fibers)<Availability>();
    return {
      interrupt: FiberSet.clear(fibers),
      run: <A, E>(effect: Effect.Effect<A, E, Availability>, headers: IncomingHttpHeaders) => {
        const active = context.active();
        const parent = (
          trace.getSpan(active) ?? trace.getSpan(propagation.extract(active, headers))
        )?.spanContext();
        return run(parent ? OtelTracer.withSpanContext(effect, parent) : effect);
      },
    };
  })
);
function problem(status: number, name: string, title: string) {
  return {
    type: `https://github.com/rafaeltab/wallpaperdb/blob/main/docs/problems/${name}.md`,
    title,
    status,
  };
}
const isTransportError = Schema.is(
  Schema.Struct({ code: Schema.String, statusCode: Schema.Number })
);
function sendError(error: unknown, request: FastifyRequest, reply: FastifyReply) {
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
  request.log.error({ err: error }, 'Tags request failed');
  return reply
    .code(500)
    .type('application/problem+json')
    .send(problem(500, 'generic-server', 'Internal server error'));
}
function unavailableSchema(properties: Record<string, object>, required: string[]) {
  return {
    description: 'Service unavailable',
    content: {
      'application/problem+json': {
        schema: {
          allOf: [
            { $ref: 'ProblemDetails#' },
            {
              type: 'object',
              required: ['type', 'title', 'status', 'timestamp', ...required],
              properties: {
                status: { type: 'integer', enum: [503] },
                timestamp: { type: 'string' },
                ...properties,
              },
            },
          ],
        },
      },
    },
  };
}
export interface HttpConfig {
  readonly nodeEnv: 'development' | 'production' | 'test';
  readonly port: number;
}
export async function createHttpApp<E>(
  config: HttpConfig,
  services: Layer.Layer<Availability, E>,
  options: {
    readonly logger?: boolean;
    readonly signal?: AbortSignal;
    readonly shutdownTimeoutMs?: number;
  } = {}
): Promise<FastifyInstance> {
  const runtime = ManagedRuntime.make(executionLayer.pipe(Layer.provide(services)));
  const app = Fastify({
    logger: options.logger ?? false,
    return503OnClosing: false,
    requestTimeout: 10000,
    connectionTimeout: 10000,
    frameworkErrors: sendError,
  });
  app.decorate('connectionsState', { isShuttingDown: false, connectionsInitialized: false });
  let shutdownTimer: ReturnType<typeof setTimeout> | undefined;
  app.addHook('preClose', async () => {
    app.connectionsState.isShuttingDown = true;
    shutdownTimer = setTimeout(() => {
      void runtime
        .runPromise(HttpExecution.use((execution) => execution.interrupt))
        .catch(() => undefined)
        .finally(() => app.server.closeAllConnections());
    }, options.shutdownTimeoutMs ?? 5000);
    shutdownTimer.unref();
  });
  app.setNotFoundHandler((_request, reply) =>
    reply
      .code(404)
      .type('application/problem+json')
      .send(problem(404, 'not-found', 'Not found'))
  );
  app.setErrorHandler(sendError);
  app.addHook('onClose', async () => {
    clearTimeout(shutdownTimer);
    await runtime.dispose();
  });
  try {
    const { run } = await runtime.runPromise(HttpExecution, { signal: options.signal });
    if (config.nodeEnv === 'development') {
      // Own preflight validation so failures use the HTTP problem contract.
      app.addHook('onRequest', async (request, reply) => {
        if (
          request.method === 'OPTIONS' &&
          (!request.headers.origin || !request.headers['access-control-request-method'])
        ) {
          return reply
            .code(400)
            .type('application/problem+json')
            .send(problem(400, 'invalid-request', 'Bad Request'));
        }
        return undefined;
      });
    }
    await app.register(cors, {
      origin:
        config.nodeEnv === 'development'
          ? [/^https?:\/\/localhost:\d+$/, /^https?:\/\/127\.0\.0\.1:\d+$/]
          : false,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      credentials: true,
      strictPreflight: false,
    });
    await registerOpenAPI(app, {
      title: 'WallpaperDB Tags API',
      version: '1.0.0',
      description: 'Tags service shell. Only operational endpoints are exposed today.',
      servers:
        config.nodeEnv === 'production'
          ? undefined
          : [{ url: `http://localhost:${config.port}`, description: 'Local development server' }],
    });
    app.get(
      '/health',
      {
        schema: {
          tags: ['Health'],
          response: {
            200: { $ref: 'HealthResponse#' },
            503: unavailableSchema(
              {
                healthStatus: { type: 'string', enum: ['unhealthy', 'shutting_down'] },
                checks: { type: 'object', additionalProperties: { type: 'boolean' } },
                totalDurationMs: { type: 'number' },
              },
              ['healthStatus', 'checks']
            ),
          },
        },
      },
      async (request, reply) => {
        const result = await run(
          Availability.use((service) => service.health(app.connectionsState.isShuttingDown)),
          request.headers
        );
        if (result.status === 'healthy' || result.status === 'degraded') return result;
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
          tags: ['Health'],
          response: {
            200: { $ref: 'ReadyResponse#' },
            503: unavailableSchema(
              { ready: { type: 'boolean', enum: [false] }, reason: { type: 'string' } },
              ['ready', 'reason']
            ),
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
    await app.ready();
    app.connectionsState.connectionsInitialized = true;
    return app;
  } catch (error) {
    await app.close().catch(() => undefined);
    await runtime.dispose();
    throw error;
  }
}
