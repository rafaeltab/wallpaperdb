import cors from '@fastify/cors';
import { registerOpenAPI } from '@wallpaperdb/core/openapi';
import { ManagedRuntime, type Layer } from 'effect';
import Fastify, { type FastifyInstance } from 'fastify';
import { Availability } from '../availability/index.js';

function problem(status: number, name: string, title: string) {
  return {
    type: `https://github.com/rafaeltab/wallpaperdb/blob/main/docs/problems/${name}.md`,
    title,
    status,
  };
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
  options: { readonly logger?: boolean; readonly signal?: AbortSignal } = {}
): Promise<FastifyInstance> {
  const runtime = ManagedRuntime.make(services);
  const app = Fastify({ logger: options.logger ?? false });
  app.setNotFoundHandler((_request, reply) =>
    reply
      .code(404)
      .type('application/problem+json')
      .send(problem(404, 'not-found', 'Not found'))
  );
  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error }, 'Tags request failed');
    return reply
      .code(500)
      .type('application/problem+json')
      .send(problem(500, 'generic-server', 'Internal server error'));
  });
  app.addHook('onClose', () => runtime.dispose());
  const availability = await runtime.runPromise(Availability, { signal: options.signal });
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
    async (_request, reply) => {
      const result = await runtime.runPromise(availability.health(false));
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
    async (_request, reply) => {
      const result = await runtime.runPromise(availability.ready(false, true));
      if (result.ready) return result;
      return reply
        .code(503)
        .type('application/problem+json')
        .send({ ...problem(503, 'service-unavailable', 'Service unavailable'), ...result });
    }
  );
  await app.ready();
  return app;
}
