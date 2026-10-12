import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import {
  createTestHttpApp as createHttpApp,
  EmptyCatalogue,
  httpConfig,
} from './unit/http-fixture.js';

describe('health HTTP contract', () => {
  it.each([
    'degraded',
    'unhealthy',
  ] as const)('represents %s health as Problem Details', async (status) => {
    const checks = { opensearch: status === 'degraded', nats: false, otel: false };
    const app = await createHttpApp(httpConfig, {
      catalogue: new EmptyCatalogue(),
      admission: { admit: () => Effect.succeed({ _tag: 'Allowed', remaining: 100, reset: 1000 }) },
      availability: {
        health: () =>
          Effect.succeed({
            status,
            checks,
            timestamp: '2026-09-15T12:00:00.000Z',
            totalDurationMs: 25,
          }),
        ready: () => Effect.succeed({ ready: true, timestamp: '2026-09-15T12:00:00.000Z' }),
      },
    });
    try {
      const response = await app.inject({ url: '/health' });
      expect(response.statusCode).toBe(503);
      expect(response.headers['content-type']).toContain('application/problem+json');
      expect(response.json()).toMatchObject({
        type: 'https://github.com/rafaeltab/wallpaperdb/blob/main/docs/problems/service-unavailable.md',
        title: 'Service unavailable',
        status: 503,
        healthStatus: status,
        timestamp: '2026-09-15T12:00:00.000Z',
        totalDurationMs: 25,
        checks,
      });
    } finally {
      await app.close();
    }
  });

  it('documents health and readiness success schemas and Problem Details failures', async () => {
    const app = await createHttpApp(httpConfig, {
      catalogue: new EmptyCatalogue(),
      admission: { admit: () => Effect.succeed({ _tag: 'Allowed', remaining: 100, reset: 1000 }) },
    });
    try {
      const response = await app.inject({ url: '/documentation/json' });
      expect(response.statusCode).toBe(200);
      const specification = response.json();
      const health = specification.paths['/health'].get;
      const readiness = specification.paths['/ready'].get;
      expect(health).toMatchObject({
        tags: ['Health'],
        responses: {
          200: {
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/HealthResponse' } },
            },
          },
          503: {
            content: {
              'application/problem+json': {
                schema: {
                  required: expect.arrayContaining([
                    'type',
                    'title',
                    'status',
                    'timestamp',
                    'healthStatus',
                    'checks',
                  ]),
                  properties: {
                    type: {
                      enum: [
                        'https://github.com/rafaeltab/wallpaperdb/blob/main/docs/problems/service-unavailable.md',
                      ],
                    },
                    status: { enum: [503] },
                    healthStatus: { enum: ['degraded', 'unhealthy', 'shutting_down'] },
                    totalDurationMs: { type: 'number' },
                    checks: { additionalProperties: { type: 'boolean' } },
                  },
                },
              },
            },
          },
        },
      });
      expect(readiness).toMatchObject({
        tags: ['Health'],
        responses: {
          200: {
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ReadyResponse' } },
            },
          },
          503: {
            content: {
              'application/problem+json': {
                schema: {
                  required: expect.arrayContaining([
                    'type',
                    'title',
                    'status',
                    'timestamp',
                    'ready',
                  ]),
                  properties: {
                    type: {
                      enum: [
                        'https://github.com/rafaeltab/wallpaperdb/blob/main/docs/problems/service-unavailable.md',
                      ],
                    },
                    status: { enum: [503] },
                    ready: { enum: [false] },
                    reason: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      });
    } finally {
      await app.close();
    }
  });

  it('returns healthy/ready success and Problem Details for unavailability and unknown routes', async () => {
    const app = await createHttpApp(httpConfig, {
      catalogue: new EmptyCatalogue(),
      admission: { admit: () => Effect.succeed({ _tag: 'Allowed', remaining: 100, reset: 1000 }) },
    });
    try {
      expect((await app.inject({ url: '/health' })).json()).toMatchObject({
        status: 'healthy',
        checks: { nats: true, opensearch: true, otel: true },
      });
      const notReady = await app.inject({ url: '/ready' });
      expect(notReady.statusCode).toBe(503);
      expect(notReady.headers['content-type']).toContain('application/problem+json');
      expect(notReady.json()).toMatchObject({
        type: 'https://github.com/rafaeltab/wallpaperdb/blob/main/docs/problems/service-unavailable.md',
        status: 503,
        ready: false,
        reason: 'Service is not yet initialized',
      });
      app.connectionsState.connectionsInitialized = true;
      expect((await app.inject({ url: '/ready' })).json().ready).toBe(true);
      app.connectionsState.isShuttingDown = true;
      const health = await app.inject({ url: '/health' });
      expect(health.statusCode).toBe(503);
      expect(health.headers['content-type']).toContain('application/problem+json');
      expect(health.json()).toMatchObject({
        type: 'https://github.com/rafaeltab/wallpaperdb/blob/main/docs/problems/service-unavailable.md',
        status: 503,
        healthStatus: 'shutting_down',
        checks: {},
      });
      expect(health.json()).not.toHaveProperty('totalDurationMs');
      const stopping = await app.inject({ url: '/ready' });
      expect(stopping.statusCode).toBe(503);
      expect(stopping.headers['content-type']).toContain('application/problem+json');
      expect(stopping.json()).toMatchObject({
        type: 'https://github.com/rafaeltab/wallpaperdb/blob/main/docs/problems/service-unavailable.md',
        status: 503,
        ready: false,
        reason: 'Service is shutting down',
        timestamp: expect.any(String),
      });
      const missing = await app.inject({ url: '/unknown' });
      expect(missing.json()).toMatchObject({
        status: 404,
        type: 'https://github.com/rafaeltab/wallpaperdb/blob/main/docs/problems/not-found.md',
      });
    } finally {
      await app.close();
    }
  });
});
