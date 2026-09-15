import crypto from 'node:crypto';
import cors from '@fastify/cors';
import { registerOpenAPI } from '@wallpaperdb/core/openapi';
import { recordCounter, recordHistogram } from '@wallpaperdb/core/telemetry';
import { Effect } from 'effect';
import Fastify, { type FastifyInstance } from 'fastify';
import { GraphQLError, NoSchemaIntrospectionCustomRule } from 'graphql';
import mercurius from 'mercurius';
import type { Admission } from '../admission/index.js';
import type { Availability } from '../availability/index.js';
import type { Catalogue } from '../catalogue/index.js';
import { createGraphql } from '../graphql/index.js';
import { runGatewayEffect } from '../runtime.js';
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
}
export interface HttpPorts {
  readonly catalogue: Catalogue;
  readonly admission: Admission;
  readonly availability: Availability;
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
    if (isGraphql(request.url))
      return reply
        .code(status)
        .send(graphqlError(status === 500 ? 'INTERNAL_SERVER_ERROR' : 'BAD_REQUEST', title));
    return reply
      .code(status)
      .type('application/problem+json')
      .send(problem(status, status === 500 ? 'generic-server' : 'invalid-request', title));
  });
}
function installAdmission(app: FastifyInstance, config: HttpConfig, admission: Admission) {
  app.addHook('preHandler', async (request, reply) => {
    if (!isGraphql(request.url)) return;
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
    const result = await runGatewayEffect(
      admission.admit(fingerprint(request.ip, request.headers['user-agent']))
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

function installHealth(app: FastifyInstance, availability: Availability) {
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
    async (_request, reply) => {
      const health = await runGatewayEffect(
        availability.health(app.connectionsState.isShuttingDown)
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
    async (_request, reply) => {
      const ready = await runGatewayEffect(
        availability.ready(
          app.connectionsState.isShuttingDown,
          app.connectionsState.connectionsInitialized
        )
      );
      if (ready.ready) return ready;
      return reply
        .code(503)
        .type('application/problem+json')
        .send({ ...problem(503, 'service-unavailable', 'Service unavailable'), ...ready });
    }
  );
}
export async function createHttpApp(
  config: HttpConfig,
  ports: HttpPorts,
  options: { logger?: boolean } = {}
): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false });
  app.decorate('connectionsState', { isShuttingDown: false, connectionsInitialized: false });
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
  installAdmission(app, config, ports.admission);
  const graphql = createGraphql(ports.catalogue, config);
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
  app.graphql.addHook('preExecution', async (schema, document, _context, variables) => {
    const result = await runGatewayEffect(
      Effect.sync(() => inspectQuery(schema, document, variables ?? {}, config)).pipe(
        Effect.withSpan('admission.inspect_query')
      )
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
      } else {
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
  installHealth(app, ports.availability);
  return app;
}

function recordTelemetry(record: () => void): void {
  try {
    record();
  } catch {
    // Security decisions must remain independent of telemetry availability.
  }
}
