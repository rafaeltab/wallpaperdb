import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { expect, it } from 'vitest';
import { t3Execution } from '../src/adapters/t3/index.js';
import { fileStore } from '../src/adapters/store/index.js';
import { initializeState } from '../src/platform/index.js';
import {
  Job,
  JobLive,
  JobStore,
  Execution,
  Time,
  Issues,
  type Intent,
  type StageRequest,
} from '../src/capabilities/job/index.js';
import { protocol } from './fixtures/setup.js';

it('migrates a retained legacy worker once while preserving its immutable stage and observation history', async () => {
  const host = await protocol();
  const previous = process.env.FACTORY_FIXTURE;
  process.env.FACTORY_FIXTURE = host.configFile;
  let runtime: ManagedRuntime.ManagedRuntime<Job, never> | undefined;
  try {
    const intent: Intent = {
      id: '1',
      issue: 577,
      issueUrl: 'https://github.com/rafaeltab/wallpaperdb/issues/577',
      base: host.base,
      context: 'issue only',
      branch: 'factory/job-1',
      createdAt: 1,
      expectedStage: 'implementation',
    };
    const adapter = t3Execution({
      ...host.mcp,
      binary: host.binary,
      project: host.repository,
      projectId: 'project-id',
    });
    await host.save({ lost: false });
    await Effect.runPromise(adapter.launch(intent));
    const directory = join(host.directory, 'legacy');
    await mkdir(directory);
    const stage: StageRequest = {
      index: 0,
      stage: 'implementation',
      threadId: 'thread-live',
      commit: host.base,
      previousRunId: null,
    };
    const original = JSON.stringify(stage);
    await writeFile(join(directory, 'stage-0.json'), original);
    const observation = JSON.stringify({ ...stage, runId: 'legacy-run' });
    await writeFile(join(directory, 'stage-0-run.json'), observation);
    initializeState(directory);
    const store = fileStore(directory);
    await Effect.runPromise(store.reserve(intent));
    runtime = ManagedRuntime.make(
      JobLive.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(JobStore, store),
            Layer.succeed(Execution, adapter),
            Layer.succeed(Time, { now: () => Effect.succeed(2) }),
            Layer.succeed(Issues, {
              pullRequest: () => Effect.succeed({ kind: 'absent' as const }),
              inspect: () =>
                Effect.succeed({
                  open: true,
                  author: 'rafaeltab',
                  labels: ['ready-for-agent'],
                  blockers: [],
                  blockersReady: true,
                  url: intent.issueUrl,
                }),
            })
          )
        )
      )
    );
    const status = () => runtime!.runPromise(Effect.flatMap(Job, (job) => job.status()));
    const old = {
      jobId: intent.id,
      stage: 'implementation',
      base: host.base,
      commit: host.base,
      outcome: '<TASK>COMPLETE</TASK>',
      tests: true,
      coverage: true,
      crap: true,
      reviews: false,
    };
    await host.save({
      overrides: { status: 'completed' },
      messages: [{ role: 'assistant', text: JSON.stringify(old) }],
    });
    expect(await status()).toMatchObject({ delivery: { stage: 'implementation', ready: false } });
    await status();
    await status();
    expect(
      (await Effect.runPromise(fileStore(directory).readControl())).reconciliation
    ).toMatchObject({ migrated: true, attempts: 0 });
    expect(await Effect.runPromise(store.readStage(0))).toEqual(stage);
    expect(await readFile(join(directory, 'stage-0.json'), 'utf8')).toBe(original);
    expect(await readFile(join(directory, 'stage-0-run.json'), 'utf8')).toBe(observation);
    const sends = (await host.calls()).filter((c) => c.args[1] === 't3_thread_send');
    expect(sends).toHaveLength(1);
    expect(JSON.parse(sends[0].args[2]).threadId).toBe('thread-live');
    await host.save({ base: host.base, complete: true, overrides: { status: 'completed' } });
    expect(await status()).toMatchObject({ delivery: { stage: 'review', ready: false } });
  } finally {
    await runtime?.dispose();
    if (previous === undefined) delete process.env.FACTORY_FIXTURE;
    else process.env.FACTORY_FIXTURE = previous;
    await host.cleanup();
  }
});
