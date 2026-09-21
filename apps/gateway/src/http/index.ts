import crypto from 'node:crypto';
import type { Socket } from 'node:net';
import cors from '@fastify/cors';
import { registerOpenAPI } from '@wallpaperdb/core/openapi';
import { recordCounter, recordHistogram } from '@wallpaperdb/core/telemetry';
import { Cause, Effect, Exit, Latch, Layer, ManagedRuntime, Option, Schema } from 'effect';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { GraphQLError, NoSchemaIntrospectionCustomRule } from 'graphql';
import mercurius from 'mercurius';
import { Admission } from '../admission/index.js';
import { Availability } from '../availability/index.js';
import { createGraphql } from '../graphql/index.js';
import { HttpExecution, httpExecutionLayer, type HttpServices } from '../runtime.js';
import { inspectQuery } from './security.js';

export interface HttpConfig {
  readonly port: number;
  readonly nodeEnv: 'development' | 'production' | 'test';
  readonly mediaServiceUrl: string;
  readonly mediaPublicBaseUrl?: string;
  readonly mediaPublicPath: string;
  readonly graphqlMaxDepth: number;
  readonly graphqlMaxComplexity: number;
  readonly graphqlMaxUniqueFields: number;
  readonly graphqlMaxAliases: number;
  readonly graphqlMaxBatchSize: number;
  readonly graphqlIntrospectionEnabled: boolean;
  readonly rateLimitMaxAnonymous: number;
}
export interface ConnectionsState {
  isShuttingDown: boolean;
  connectionsInitialized: boolean;
}
declare module 'fastify' {
  interface FastifyInstance {
    connectionsState: ConnectionsState;
  }
  interface FastifyRequest {
    gatewaySignal?: AbortSignal;
  }
}
const problems = 'https://github.com/rafaeltab/wallpaperdb/blob/main/docs/problems/';
function problem(status: number, type: string, title: string) {
  return { type: `${problems}${type}.md`, title, status };
}
function isGraphql(url: string) {
  return url.split('?')[0] === '/graphql';
}
function graphqlError(code: string, message: string, extensions: Record<string, unknown> = {}) {
  return { errors: [{ message, extensions: { code, ...extensions } }] };
}
function fingerprint(ip: string, userAgent?: string) {
  return crypto
    .createHash('sha256')
    .update(`${ip}\u0000${userAgent ?? ''}`)
    .digest('hex');
}
const operationRequest = Schema.is(
  Schema.Struct({
    operationName: Schema.optional(Schema.NullOr(Schema.String)),
  })
);
function requestOperationName(request: FastifyRequest): string | undefined {
  const input = request.method === 'GET' ? request.query : request.body;
  return operationRequest(input) ? (input.operationName ?? undefined) : undefined;
}
function installErrors(app: FastifyInstance) {
  app.setNotFoundHandler((_request, reply) =>
    reply
      .code(404)
      .type('application/problem+json')
      .send(problem(404, 'not-found', 'Not found'))
  );
  app.setErrorHandler((error, request, reply) => {
    const status =
      typeof error === 'object' &&
      error !== null &&
      'statusCode' in error &&
      typeof error.statusCode === 'number' &&
      error.statusCode >= 400 &&
      error.statusCode < 500
        ? error.statusCode
        : 500;
    const title = status === 500 ? 'Internal server error' : 'Invalid request';
    if (status === 500) app.log.error({ code: 'GATEWAY_DEFECT' }, 'Gateway request failed');
    if (isGraphql(request.routeOptions.url ?? request.url))
      return reply
        .code(status)
        .send(graphqlError(status === 500 ? 'INTERNAL_SERVER_ERROR' : 'BAD_REQUEST', title));
    return reply
      .code(status)
      .type('application/problem+json')
      .send(problem(status, status === 500 ? 'generic-server' : 'invalid-request', title));
  });
}
function installAdmission(
  app: FastifyInstance,
  config: HttpConfig,
  execution: HttpExecution['Service']
) {
  app.addHook('preHandler', async (request, reply) => {
    if (request.routeOptions.url !== '/graphql') return;
    if (Array.isArray(request.body)) {
      const exceeded = request.body.length > config.graphqlMaxBatchSize;
      if (exceeded) {
        const batchSize = request.body.length;
        recordTelemetry(() =>
          recordCounter('graphql.security.batch_exceeded', 1, {
            batchSize,
            threshold: config.graphqlMaxBatchSize,
          })
        );
      }
      return reply
        .code(400)
        .send(
          graphqlError(
            exceeded ? 'BATCH_LIMIT_EXCEEDED' : 'BATCH_NOT_SUPPORTED',
            exceeded ? 'Batch size exceeds maximum' : 'Batch requests are not supported'
          )
        );
    }
    const result = await execution.run(
      Admission.use((admission) =>
        admission.admit(fingerprint(request.ip, request.headers['user-agent']))
      ),
      { signal: request.gatewaySignal }
    );
    switch (result._tag) {
      case 'Allowed':
        reply.header('X-RateLimit-Limit', String(config.rateLimitMaxAnonymous));
        reply.header('X-RateLimit-Remaining', String(result.remaining));
        reply.header('X-RateLimit-Reset', String(result.reset));
        return;
      case 'Limited':
        recordTelemetry(() => recordCounter('graphql.security.rate_limited', 1));
        return reply
          .code(429)
          .header('Retry-After', String(Math.ceil(result.retryAfter / 1000)))
          .send(
            graphqlError('RATE_LIMIT_EXCEEDED', 'Rate limit exceeded', {
              retryAfter: result.retryAfter,
            })
          );
    }
  });
}
const unavailableSchema = {
  type: 'object',
  description: 'RFC 9457 Problem Details for a service that cannot accept traffic.',
  required: ['type', 'title', 'status', 'timestamp'],
  properties: {
    type: { type: 'string', enum: [`${problems}service-unavailable.md`] },
    title: { type: 'string' },
    status: { type: 'integer', enum: [503] },
    timestamp: { type: 'string', format: 'date-time' },
  },
};

function installHealth(app: FastifyInstance, execution: HttpExecution['Service']) {
  app.get(
    '/health',
    {
      schema: {
        summary: 'Health check',
        description:
          'Reports gateway availability and the status of OpenSearch, NATS, and telemetry.',
        tags: ['Health'],
        response: {
          200: { description: 'Service is healthy', $ref: 'HealthResponse#' },
          503: {
            description: 'Service is degraded or shutting down',
            content: {
              'application/problem+json': {
                schema: {
                  ...unavailableSchema,
                  required: [...unavailableSchema.required, 'healthStatus', 'checks'],
                  properties: {
                    ...unavailableSchema.properties,
                    healthStatus: {
                      type: 'string',
                      enum: ['degraded', 'unhealthy', 'shutting_down'],
                    },
                    totalDurationMs: { type: 'number' },
                    checks: { type: 'object', additionalProperties: { type: 'boolean' } },
                  },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const health = await execution.run(
        Availability.use((availability) =>
          availability.health(app.connectionsState.isShuttingDown)
        ),
        { signal: request.gatewaySignal }
      );
      if (health.status === 'healthy') return health;
      return reply
        .code(503)
        .type('application/problem+json')
        .send({
          checks: health.checks,
          timestamp: health.timestamp,
          healthStatus: health.status,
          totalDurationMs: health.totalDurationMs,
          ...problem(503, 'service-unavailable', 'Service unavailable'),
        });
    }
  );
  app.get(
    '/ready',
    {
      schema: {
        summary: 'Readiness check',
        description: 'Reports whether the gateway has initialized and can accept traffic.',
        tags: ['Health'],
        response: {
          200: { description: 'Service is ready to accept traffic', $ref: 'ReadyResponse#' },
          503: {
            description: 'Connections are not initialized or the service is shutting down',
            content: {
              'application/problem+json': {
                schema: {
                  ...unavailableSchema,
                  required: [...unavailableSchema.required, 'ready'],
                  properties: {
                    ...unavailableSchema.properties,
                    ready: { type: 'boolean', enum: [false] },
                    reason: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const ready = await execution.run(
        Availability.use((availability) =>
          availability.ready(
            app.connectionsState.isShuttingDown,
            app.connectionsState.connectionsInitialized
          )
        ),
        { signal: request.gatewaySignal }
      );
      if (ready.ready) return ready;
      return reply
        .code(503)
        .type('application/problem+json')
        .send({ ...problem(503, 'service-unavailable', 'Service unavailable'), ...ready });
    }
  );
}
export async function createHttpApp<E>(
  config: HttpConfig,
  services: Layer.Layer<HttpServices, E>,
  options: { logger?: boolean; shutdownTimeoutMs?: number } = {}
): Promise<FastifyInstance> {
  const runtime = ManagedRuntime.make(httpExecutionLayer.pipe(Layer.provide(services)));
  const app = Fastify({ logger: options.logger ?? false, forceCloseConnections: 'idle' });
  app.decorate('connectionsState', { isShuttingDown: false, connectionsInitialized: false });
  app.addHook('onClose', () => runtime.dispose());
  try {
    const execution = await runtime.runPromise(HttpExecution);
    const requests = installRequestLifecycle(app);
    app.addHook('preClose', async () => {
      app.connectionsState.isShuttingDown = true;
      await runtime.runPromise(
        requests.drain(options.shutdownTimeoutMs ?? 5000).pipe(Effect.andThen(execution.drain(0)))
      );
    });
    installErrors(app);
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
      title: 'WallpaperDB Gateway API',
      version: '1.0.0',
      description: 'GraphQL gateway for browsing wallpapers and public contributor Profiles.',
    });
    installAdmission(app, config, execution);
    const graphql = createGraphql(execution, config);
    await app.register(mercurius, {
      ...graphql,
      graphiql: config.nodeEnv === 'development',
      path: '/graphql',
      queryDepth: config.graphqlMaxDepth,
      validationRules:
        config.nodeEnv === 'production' || !config.graphqlIntrospectionEnabled
          ? [NoSchemaIntrospectionCustomRule]
          : [],
      errorFormatter(execution) {
        const first = execution.errors?.[0]?.originalError;
        const transportStatus =
          first &&
          'statusCode' in first &&
          typeof first.statusCode === 'number' &&
          first.statusCode >= 400 &&
          first.statusCode <= 599
            ? first.statusCode
            : undefined;
        const unexpectedTransportFailure =
          execution.data === undefined && first !== undefined && !(first instanceof GraphQLError);
        const statusCode = execution.data
          ? 200
          : (transportStatus ?? (unexpectedTransportFailure ? 500 : 200));
        const errors =
          execution.errors?.flatMap((error) => {
            const original = error.originalError;
            if (
              original &&
              'errors' in original &&
              Array.isArray(original.errors) &&
              original.errors.every((nested) => nested instanceof GraphQLError)
            ) {
              return original.errors.map((nested: GraphQLError) => nested.toJSON());
            }
            if (!original || original instanceof GraphQLError) return [error.toJSON()];
            const clientError = statusCode >= 400 && statusCode < 500;
            return [
              new GraphQLError(clientError ? 'Invalid request' : 'Internal server error', {
                path: error.path,
                extensions: { code: clientError ? 'BAD_REQUEST' : 'INTERNAL_SERVER_ERROR' },
              }).toJSON(),
            ];
          }) ?? [];
        return { statusCode, response: { data: execution.data ?? null, errors } };
      },
    });
    app.graphql.addHook('preExecution', async (schema, document, context, variables) => {
      const result = await execution.run(
        Effect.sync(() =>
          inspectQuery(
            schema,
            document,
            variables ?? {},
            config,
            requestOperationName(context.reply.request)
          )
        ).pipe(Effect.withSpan('admission.inspect_query'))
      );
      recordTelemetry(() => recordHistogram('graphql.query.complexity', result.complexity));
      if (result.error) {
        const extensions = result.error.extensions;
        if (extensions.code === 'COMPLEXITY_LIMIT_EXCEEDED') {
          recordTelemetry(() =>
            recordCounter('graphql.security.complexity_exceeded', 1, {
              complexity: result.complexity,
              threshold: config.graphqlMaxComplexity,
            })
          );
        } else if (extensions.code === 'BREADTH_LIMIT_EXCEEDED') {
          const aliases = typeof extensions.aliases === 'number';
          recordTelemetry(() =>
            recordCounter('graphql.security.breadth_exceeded', 1, {
              type: aliases ? 'aliases' : 'unique_fields',
              count: aliases ? Number(extensions.aliases) : Number(extensions.unique_fields),
              threshold: aliases ? config.graphqlMaxAliases : config.graphqlMaxUniqueFields,
            })
          );
        }
        throw result.error;
      }
    });
    installHealth(app, execution);
    return app;
  } catch (error) {
    const cleanup = await Effect.runPromiseExit(
      Effect.tryPromise(() => app.close()).pipe(Effect.ensuring(runtime.disposeEffect))
    );
    if (Exit.isFailure(cleanup))
      throw new AggregateError(
        [error, Cause.squash(cleanup.cause)],
        'HTTP initialization and cleanup failed'
      );
    throw error;
  }
}

function recordTelemetry(record: () => void): void {
  try {
    record();
  } catch {
    // Security decisions must remain independent of telemetry availability.
  }
}

function installRequestLifecycle(app: FastifyInstance) {
  const active = new Set<AbortController>();
  const connections = new Set<Socket>();
  app.server.on('connection', (socket) => {
    connections.add(socket);
    socket.once('close', () => connections.delete(socket));
  });
  const completions = new WeakMap<FastifyRequest, () => void>();
  const empty = Latch.makeUnsafe(true);
  let closing = false;
  app.decorateRequest('gatewaySignal');
  app.addHook('onRequest', async (request, reply) => {
    if (closing) {
      if (isGraphql(request.routeOptions.url ?? request.url))
        return reply.code(503).send(graphqlError('SERVICE_UNAVAILABLE', 'Service unavailable'));
      return reply
        .code(503)
        .type('application/problem+json')
        .send(problem(503, 'service-unavailable', 'Service unavailable'));
    }
    const controller = new AbortController();
    request.gatewaySignal = controller.signal;
    active.add(controller);
    empty.closeUnsafe();
    const complete = () => {
      request.raw.removeListener('aborted', abandon);
      reply.raw.removeListener('close', abandon);
      completions.delete(request);
      active.delete(controller);
      if (active.size === 0) {
        empty.openUnsafe();
        if (closing) for (const socket of connections) socket.end();
      }
    };
    const abandon = () => {
      if (!reply.raw.writableFinished) controller.abort();
      complete();
    };
    completions.set(request, complete);
    request.raw.once('aborted', abandon);
    reply.raw.once('close', abandon);
  });
  app.addHook('onResponse', async (request) => {
    completions.get(request)?.();
  });
  return {
    drain: Effect.fn('http.requests.drain')(function* (timeoutMs: number) {
      closing = true;
      const listenerClosed = Latch.makeUnsafe(!app.server.listening);
      if (app.server.listening) app.server.close(() => listenerClosed.openUnsafe());
      if (active.size === 0) for (const socket of connections) socket.end();
      const completed = yield* Effect.all([empty.await, listenerClosed.await], {
        concurrency: 'unbounded',
      }).pipe(Effect.timeoutOption(timeoutMs));
      if (Option.isNone(completed)) {
        for (const controller of active) controller.abort();
        app.server.closeAllConnections();
      }
    }),
  };
}
