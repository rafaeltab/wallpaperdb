import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { writeFile } from 'node:fs/promises';
import { Effect } from 'effect';
import { z } from 'zod';
import { expect, it, vi } from 'vitest';
import { startFactory } from '../src/composition/index.js';
import { fileStore, fileScheduleStore } from '../src/adapters/store/index.js';
import type { Intent } from '../src/capabilities/job/index.js';
import { protocol } from './fixtures/setup.js';

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

it.each(['absent', 'ambiguous'] as const)(
  'reports successful %s retained-thread observations unavailable, without resending, and keeps a verified failed run available for explicit action',
  async (kind) => {
    const host = await protocol();
    const previous = { path: process.env.PATH, fixture: process.env.FACTORY_FIXTURE };
    process.env.PATH = `${host.directory}:${previous.path}`;
    process.env.FACTORY_FIXTURE = host.configFile;
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
    const state = `${host.directory}/state`;
    const intent: Intent = {
      id: 'retained',
      issue: 988588,
      issueUrl: 'https://github.com/rafaeltab/wallpaperdb/issues/988588',
      base: host.base,
      branch: 'factory/retained',
      createdAt: 1,
      context: 'Controlled retained work; no launch authorized',
      expectedStage: 'implementation',
    };
    const store = fileStore(state);
    const worktree = `${host.directory}/retained-worktree`;
    execFileSync('git', ['worktree', 'add', '-b', intent.branch, worktree, host.base], {
      cwd: host.repository,
      stdio: 'pipe',
    });
    const resource = {
      threadId: 'thread-retained',
      projectId: 'project-id',
      title: 'Factory retained',
      providerInstanceId: 'codex',
      model: 'gpt-6.1-sol',
      branch: intent.branch,
      worktreePath: worktree,
      status: 'failed',
      latestRunId: 'run-1',
      runCount: 1,
      pendingRequestCount: 0,
    };
    try {
      const retain = async () => {
        expect(await Effect.runPromise(store.reserve(intent))).toBe(true);
        expect(await Effect.runPromise(store.claimLaunch())).toBe(true);
        expect(
          await Effect.runPromise(
            fileScheduleStore(state).save({
              revision: 0,
              concurrency: 1,
              allowance: 1,
              paused: true,
              admissions: [{ issue: intent.issue, base: host.base, context: intent.context }],
            })
          )
        ).toBe(true);
      };
      if (kind === 'ambiguous') await retain();
      if (kind === 'ambiguous')
        await writeFile(`${host.directory}/resource.json`, JSON.stringify(resource));
      await host.save({ duplicate: kind === 'ambiguous', planning: { issues: [] } });
      const running = await startFactory({
        FACTORY_PROJECT: host.repository,
        FACTORY_T3_PROJECT_ID: 'project-id',
        FACTORY_BASE: host.base,
        FACTORY_T3_BINARY: host.binary,
        FACTORY_STATE: state,
        FACTORY_PORT: '0',
        FACTORY_OTEL_ENDPOINT: `http://127.0.0.1:${address.port}`,
      });
      try {
        if (kind === 'absent') {
          await vi.waitFor(() => expect(observations.at(-1)?.healthy).toBe(1), {
            timeout: 15000,
            interval: 50,
          });
          expect((await running.app.inject('/api/scheduler')).json()).toMatchObject({
            state: { admissions: [] },
          });
          await retain();
        }
        expect((await running.app.inject('/api/job')).json()).toMatchObject({
          execution: { kind },
        });
        expect((await running.app.inject('/health')).json()).toEqual({ status: 'ok' });
        await vi.waitFor(
          () => expect(observations.at(-1)?.healthy, JSON.stringify(observations)).toBe(0),
          { timeout: 15000, interval: 50 }
        );
        const failedAt = observations.at(-1)?.observed ?? 0;
        expect(failedAt).toBeGreaterThan(0);
        expect(await Effect.runPromise(store.read())).toEqual(intent);
        await writeFile(`${host.directory}/resource.json`, JSON.stringify(resource));
        await host.save({});
        expect((await running.app.inject('/api/job')).json()).toMatchObject({
          execution: { kind: 'found', status: 'failed' },
          resume: { runId: 'run-1' },
        });
        await vi.waitFor(
          () =>
            expect(
              observations.some((item) => item.healthy === 1 && item.observed > failedAt)
            ).toBe(true),
          { timeout: 15000, interval: 50 }
        );
        expect(await Effect.runPromise(store.read())).toEqual(intent);
        expect(await Effect.runPromise(store.claimLaunch())).toBe(false);
        expect(
          (await host.calls()).filter(
            (call) =>
              call.binary === 't3' &&
              ['start', 'send'].includes(call.args[1]) &&
              !call.args.includes('--help')
          )
        ).toEqual([]);
      } finally {
        await running.close();
      }
    } finally {
      process.stdout.write(`Retained availability ${kind}: ${JSON.stringify(observations)}\n`);
      collector.closeAllConnections();
      await new Promise<void>((resolve) => collector.close(() => resolve()));
      process.env.PATH = previous.path;
      if (previous.fixture === undefined) delete process.env.FACTORY_FIXTURE;
      else process.env.FACTORY_FIXTURE = previous.fixture;
      await host.cleanup();
    }
  }
);
