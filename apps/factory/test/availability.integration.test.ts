import { createServer } from 'node:http';
import { once } from 'node:events';
import { writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { expect, it, vi } from 'vitest';
import { startFactory } from '../src/composition/index.js';
import { protocol } from './fixtures/setup.js';

it('exports actual scheduler failure while liveness succeeds, then recovers through an intentional pause and owning question', async () => {
  const host = await protocol();
  const previous = { path: process.env.PATH, fixture: process.env.FACTORY_FIXTURE };
  process.env.PATH = `${host.directory}:${previous.path}`;
  process.env.FACTORY_FIXTURE = host.configFile;
  const observations: {
    healthy: number;
    observed: number;
    healthyUnit: string;
    observedUnit: string;
  }[] = [];
  const schema = z.object({
    resourceMetrics: z.array(
      z.object({
        scopeMetrics: z.array(
          z.object({
            metrics: z.array(
              z.object({
                name: z.string(),
                unit: z.string(),
                gauge: z
                  .object({ dataPoints: z.array(z.object({ asDouble: z.number() })) })
                  .optional(),
              })
            ),
          })
        ),
      })
    ),
  });
  const collector = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk.toString();
    });
    request.on('end', () => {
      if (request.url === '/v1/metrics') {
        const parsed = schema.parse(JSON.parse(body));
        const metrics = parsed.resourceMetrics.flatMap((resource) =>
          resource.scopeMetrics.flatMap((scope) => scope.metrics)
        );
        const healthyMetric = metrics.find((metric) => metric.name === 'factory_scheduler_healthy');
        const observedMetric = metrics.find(
          (metric) => metric.name === 'factory_scheduler_observed_at_seconds'
        );
        const healthy = healthyMetric?.gauge?.dataPoints[0]?.asDouble;
        const observed = observedMetric?.gauge?.dataPoints[0]?.asDouble;
        if (healthy !== undefined && observed !== undefined)
          observations.push({
            healthy,
            observed,
            healthyUnit: healthyMetric?.unit ?? '',
            observedUnit: observedMetric?.unit ?? '',
          });
      }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{}');
    });
  });
  collector.listen(0, '127.0.0.1');
  await once(collector, 'listening');
  const address = collector.address();
  if (!address || typeof address === 'string') throw new Error('Missing collector');
  const authorization = `${host.directory}/authorization`;
  await writeFile(authorization, 'Bearer controlled');
  try {
    const running = await startFactory({
      FACTORY_PROJECT: host.repository,
      FACTORY_T3_PROJECT_ID: 'project-id',
      FACTORY_BASE: host.base,
      FACTORY_T3_BINARY: host.binary,
      FACTORY_STATE: `${host.directory}/state`,
      FACTORY_PORT: '0',
      FACTORY_OTEL_ENDPOINT: `http://127.0.0.1:${address.port}`,
      FACTORY_T3_MCP_ENDPOINT: 'http://127.0.0.1:1/mcp',
      FACTORY_T3_MCP_AUTHORIZATION_FILE: authorization,
    });
    try {
      expect(
        (await running.app.inject({ method: 'POST', url: '/api/job', payload: { issue: 988588 } }))
          .statusCode
      ).toBe(202);
      await host.save({ malformed: true });
      await vi.waitFor(
        () =>
          expect(observations.some((item) => item.healthy === 0 && item.observed > 0)).toBe(true),
        { timeout: 15000, interval: 50 }
      );
      expect((await running.app.inject('/health')).json()).toEqual({ status: 'ok' });
      expect(observations.at(-1)).toMatchObject({ healthyUnit: '1', observedUnit: 's' });
      const failed = observations.at(-1)?.observed ?? 0;
      await host.save({
        activity: [
          {
            itemId: 'q',
            runId: 'run-1',
            sourceThreadId: 'thread-live',
            visibility: 'local',
            type: 'user_input_request',
            status: 'waiting',
            text: 'Which approved option?',
          },
        ],
        overrides: { status: 'waiting', pendingRequestCount: 1 },
      });
      const state = (await running.app.inject('/api/scheduler')).json().state;
      expect(
        (
          await running.app.inject({
            method: 'POST',
            url: '/api/scheduler',
            payload: { revision: state.revision, concurrency: 1, allowance: 1, paused: true },
          })
        ).statusCode
      ).toBe(200);
      await vi.waitFor(
        () =>
          expect(observations.some((item) => item.healthy === 1 && item.observed > failed)).toBe(
            true
          ),
        { timeout: 15000, interval: 50 }
      );
      expect((await running.app.inject('/api/job')).json()).toMatchObject({
        delivery: { activity: 'awaiting-answer' },
      });
    } finally {
      await running.close();
    }
  } finally {
    collector.closeAllConnections();
    await new Promise<void>((resolve) => collector.close(() => resolve()));
    process.env.PATH = previous.path;
    if (previous.fixture === undefined) delete process.env.FACTORY_FIXTURE;
    else process.env.FACTORY_FIXTURE = previous.fixture;
    await host.cleanup();
  }
});

it('keeps telemetry disabled despite an ambient OTLP endpoint', async () => {
  const host = await protocol();
  const previous = {
    fixture: process.env.FACTORY_FIXTURE,
    endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
  };
  process.env.FACTORY_FIXTURE = host.configFile;
  let exports = 0;
  const collector = createServer((request, response) => {
    exports++;
    request.resume();
    response.end('{}');
  });
  collector.listen(0, '127.0.0.1');
  await once(collector, 'listening');
  const address = collector.address();
  if (!address || typeof address === 'string') throw new Error('Missing collector');
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT = `http://127.0.0.1:${address.port}`;
  try {
    const running = await startFactory({
      FACTORY_PROJECT: host.repository,
      FACTORY_T3_PROJECT_ID: 'project-id',
      FACTORY_BASE: host.base,
      FACTORY_T3_BINARY: host.binary,
      FACTORY_STATE: `${host.directory}/state`,
      FACTORY_PORT: '0',
    });
    expect((await running.app.inject('/health')).statusCode).toBe(200);
    await running.close();
    expect(exports).toBe(0);
  } finally {
    collector.closeAllConnections();
    await new Promise<void>((resolve) => collector.close(() => resolve()));
    if (previous.fixture === undefined) delete process.env.FACTORY_FIXTURE;
    else process.env.FACTORY_FIXTURE = previous.fixture;
    if (previous.endpoint === undefined) delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    else process.env.OTEL_EXPORTER_OTLP_ENDPOINT = previous.endpoint;
    await host.cleanup();
  }
});
