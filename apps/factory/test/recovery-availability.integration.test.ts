import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { Effect } from 'effect';
import { z } from 'zod';
import { expect, it, vi } from 'vitest';
import { startFactory } from '../src/composition/index.js';
import { fileScheduleStore } from '../src/adapters/store/index.js';
import { joinFixture } from './fixtures/join.js';

const metricsSchema = z.object({
  resourceMetrics: z.array(
    z.object({
      scopeMetrics: z.array(
        z.object({
          metrics: z.array(
            z.object({
              name: z.string(),
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

async function collectAvailability() {
  const observations: { healthy: number; observed: number }[] = [];
  const collector = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk.toString();
    });
    request.on('end', () => {
      if (request.url === '/v1/metrics') {
        const metrics = metricsSchema
          .parse(JSON.parse(body))
          .resourceMetrics.flatMap((resource) =>
            resource.scopeMetrics.flatMap((scope) => scope.metrics)
          );
        const value = (name: string) =>
          metrics.find((metric) => metric.name === name)?.gauge?.dataPoints[0]?.asDouble;
        const healthy = value('factory_scheduler_healthy');
        const observed = value('factory_scheduler_observed_at_seconds');
        if (healthy !== undefined && observed !== undefined)
          observations.push({ healthy, observed });
      }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{}');
    });
  });
  collector.listen(0, '127.0.0.1');
  await once(collector, 'listening');
  const address = collector.address();
  if (!address || typeof address === 'string') throw new Error('Missing collector');
  return {
    observations,
    endpoint: `http://127.0.0.1:${address.port}`,
    close: async () => {
      collector.closeAllConnections();
      await new Promise<void>((resolve) => collector.close(() => resolve()));
    },
  };
}

it.each(['absent', 'ambiguous'] as const)(
  'reports a successful %s retained recovery binding unavailable, preserving its claim and healthy question/failed observations',
  async (kind) => {
    const f = await joinFixture({
      conflict: true,
      restack: { mcp: true, question: 'May I change this requirement?' },
    });
    const collector = await collectAvailability();
    const { observations } = collector;
    try {
      await Effect.runPromise(f.issues.prepare?.(5) ?? Effect.void);
      await Effect.runPromise(f.issues.prepare?.(5) ?? Effect.void);
      expect(
        await Effect.runPromise(
          fileScheduleStore(f.host.directory).save({
            revision: 0,
            concurrency: 1,
            allowance: 1,
            paused: true,
            admissions: [],
          })
        )
      ).toBe(true);
      const path = `${f.host.directory}/restacker.json`;
      const retained = JSON.parse(await readFile(path, 'utf8'));
      await writeFile(
        path,
        JSON.stringify({
          ...retained,
          thread: { ...retained.thread, status: 'failed', pendingRequestCount: 0 },
        })
      );
      const config = JSON.parse(await readFile(f.host.configFile, 'utf8'));
      const running = await startFactory({
        FACTORY_PROJECT: f.host.repository,
        FACTORY_T3_PROJECT_ID: 'project-id',
        FACTORY_BASE: f.host.base,
        FACTORY_T3_BINARY: f.host.binary,
        FACTORY_STATE: f.host.directory,
        FACTORY_PORT: '0',
        FACTORY_OTEL_ENDPOINT: collector.endpoint,
        FACTORY_T3_MCP_ENDPOINT: 'http://controlled.invalid/mcp',
        FACTORY_T3_MCP_AUTHORIZATION_FILE: `${f.host.directory}/mcp-auth`,
      });
      try {
        expect((await running.app.inject('/api/scheduler')).json()).toMatchObject({
          state: { admissions: [], paused: true },
          recoveries: [{ issue: 4, threadId: 'restacker' }],
        });
        await vi.waitFor(() => expect(observations.at(-1)?.healthy).toBe(1), {
          timeout: 15000,
          interval: 50,
        });
        const failedAt = observations.at(-1)?.observed ?? 0;
        await writeFile(path, JSON.stringify(retained));
        await vi.waitFor(
          async () =>
            expect((await running.app.inject('/api/scheduler')).json()).toMatchObject({
              recoveries: [
                {
                  issue: 4,
                  active: false,
                  question: 'May I change this requirement?',
                  bindingAvailable: true,
                },
              ],
            }),
          { timeout: 15000, interval: 50 }
        );
        await vi.waitFor(
          () =>
            expect(
              observations.some((item) => item.healthy === 1 && item.observed > failedAt)
            ).toBe(true),
          { timeout: 15000, interval: 50 }
        );
        const questionAt = observations.at(-1)?.observed ?? 0;
        if (kind === 'absent') await rename(path, `${path}.retained`);
        else await f.host.save({ ...config, duplicate: true });
        await vi.waitFor(
          async () =>
            expect((await running.app.inject('/api/scheduler')).json()).toMatchObject({
              recoveries: [
                { progress: 'Recovery launch pending reconciliation', bindingAvailable: false },
              ],
            }),
          { timeout: 15000, interval: 50 }
        );
        expect((await running.app.inject('/health')).json()).toEqual({ status: 'ok' });
        await vi.waitFor(
          () =>
            expect(
              observations.some((item) => item.healthy === 0 && item.observed > questionAt),
              JSON.stringify(observations)
            ).toBe(true),
          { timeout: 15000, interval: 50 }
        );
        const unavailableAt = observations.at(-1)?.observed ?? 0;
        await writeFile(
          path,
          JSON.stringify({
            ...retained,
            thread: { ...retained.thread, status: 'failed', pendingRequestCount: 0 },
          })
        );
        await f.host.save(config);
        await vi.waitFor(
          () =>
            expect(
              observations.some((item) => item.healthy === 1 && item.observed > unavailableAt)
            ).toBe(true),
          { timeout: 15000, interval: 50 }
        );
        expect((await running.app.inject('/api/scheduler')).json()).toMatchObject({
          state: { admissions: [], paused: true },
          recoveries: [
            { issue: 4, threadId: 'restacker', progress: expect.stringContaining('failed') },
          ],
        });
        expect(
          (await f.host.calls()).filter(
            (call) =>
              call.binary === 't3' && call.args[1] === 'start' && !call.args.includes('--help')
          )
        ).toHaveLength(1);
        expect(
          (await f.host.calls()).filter(
            (call) =>
              call.binary === 't3' && call.args[1] === 'send' && !call.args.includes('--help')
          )
        ).toEqual([]);
        expect((await Effect.runPromise(f.reopen().inspect(5))).blockersReady).toBe(false);
      } finally {
        await running.close();
      }
    } finally {
      process.stdout.write(`Recovery availability ${kind}: ${JSON.stringify(observations)}\n`);
      await collector.close();
      await f.close();
    }
  }
);

it('keeps idle and unlaunched writer-parked recovery available without dispatching a worker', async () => {
  const f = await joinFixture({ conflict: true, restack: { outcome: 'SIMPLE' } });
  const collector = await collectAvailability();
  const configuration = {
    FACTORY_PROJECT: f.host.repository,
    FACTORY_T3_PROJECT_ID: 'project-id',
    FACTORY_BASE: f.host.base,
    FACTORY_T3_BINARY: f.host.binary,
    FACTORY_STATE: f.host.directory,
    FACTORY_PORT: '0',
    FACTORY_OTEL_ENDPOINT: collector.endpoint,
  };
  try {
    expect(
      await Effect.runPromise(
        fileScheduleStore(f.host.directory).save({
          revision: 0,
          concurrency: 1,
          allowance: 1,
          paused: true,
          admissions: [],
        })
      )
    ).toBe(true);
    const idle = await startFactory(configuration);
    try {
      await vi.waitFor(() => expect(collector.observations.at(-1)?.healthy).toBe(1), {
        timeout: 15000,
        interval: 50,
      });
      expect((await idle.app.inject('/api/scheduler')).json()).toMatchObject({
        recoveries: [],
        state: { admissions: [], paused: true },
      });
    } finally {
      await idle.close();
    }
    const idleAt = collector.observations.at(-1)?.observed ?? 0;
    // Seed the real conflict and its dirty owning worktree while observation is stopped.
    // No resolver is required until writer coordination permits its initial launch.
    await Effect.runPromise(f.issues.prepare?.(5) ?? Effect.void);
    const owning = `${f.host.directory}/owning-C`;
    f.git('worktree', 'add', owning, 'C');
    await writeFile(`${owning}/writer.txt`, 'retained uncommitted work');
    const running = await startFactory(configuration);
    try {
      await vi.waitFor(
        () =>
          expect(
            collector.observations.some((item) => item.healthy === 1 && item.observed > idleAt)
          ).toBe(true),
        { timeout: 15000, interval: 50 }
      );
      const snapshot = (await running.app.inject('/api/scheduler')).json();
      expect(snapshot).toMatchObject({
        recoveries: [{ issue: 4 }],
        state: { admissions: [], paused: true },
      });
      expect(snapshot.recoveries[0].bindingAvailable).toBeUndefined();
      expect(
        (await f.host.calls()).filter(
          (call) =>
            call.binary === 't3' &&
            ['start', 'send'].includes(call.args[1]) &&
            !call.args.includes('--help')
        )
      ).toEqual([]);
      expect((await running.app.inject('/health')).statusCode).toBe(200);
    } finally {
      await running.close();
    }
  } finally {
    process.stdout.write(
      `Unlaunched recovery availability: ${JSON.stringify(collector.observations)}\n`
    );
    await collector.close();
    await f.close();
  }
});

it('keeps a capacity-deferred COMPLEX review binding available without delivering the review', async () => {
  const f = await joinFixture({ conflict: true, restack: { outcome: 'COMPLEX' } });
  try {
    await Effect.runPromise(f.issues.prepare?.(5) ?? Effect.void);
    await Effect.runPromise(f.issues.prepare?.(5, () => Effect.succeed(false)) ?? Effect.void);
    expect(await Effect.runPromise(f.reopen().recoveries?.() ?? Effect.succeed([]))).toEqual([
      expect.objectContaining({
        issue: 4,
        classification: 'COMPLEX',
        active: false,
        bindingAvailable: true,
        progress: 'Waiting for recovery capacity',
      }),
    ]);
    expect((await Effect.runPromise(f.reopen().inspect(5))).blockersReady).toBe(false);
    expect(
      (await f.host.calls()).filter(
        (call) => call.binary === 't3' && call.args[1] === 'send' && !call.args.includes('--help')
      )
    ).toEqual([]);
  } finally {
    await f.close();
  }
});
