import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Effect, Layer } from 'effect';
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
  type Control,
} from '../src/capabilities/job/index.js';
import { protocol } from './fixtures/setup.js';

for (const explicit of [false, true]) {
  it.each(['manual', 'retained-manual', 'answer'])(
    `preserves legacy initial delivery through %s adoption, explicit receipt=${explicit}`,
    async (mode) => {
      const host = await protocol();
      const previous = process.env.FACTORY_FIXTURE;
      process.env.FACTORY_FIXTURE = host.configFile;
      try {
        const intent: Intent = {
          id: '1',
          issue: 577,
          issueUrl: 'https://github.com/rafaeltab/wallpaperdb/issues/577',
          base: host.base,
          context: '',
          branch: 'factory/job-1',
          createdAt: 1,
          expectedStage: 'implementation',
        };
        const attempt = { ...intent, id: '1:retry-3', branch: 'factory/job-1-retry-3' };
        const adapter = t3Execution({
          binary: host.binary,
          project: host.repository,
          projectId: 'project-id',
        });
        await host.save({ lost: false });
        await Effect.runPromise(adapter.launch(attempt));
        const directory = join(host.directory, 'legacy-job');
        await mkdir(directory);
        const initial: StageRequest = {
          index: 3,
          ordinal: 1,
          stage: 'implementation',
          threadId: 'thread-live',
          commit: host.base,
          previousRunId: null,
        };
        const adopted: StageRequest = {
          ...initial,
          index: 4,
          ordinal: 2,
          previousRunId: 'run-1',
          observedRunId: 'manual-2',
          deliveryIndex: 3,
          resume: false,
          repairOrigin: 3,
        };
        const original = JSON.stringify(initial);
        await writeFile(join(directory, 'stage-3.json'), original);
        if (mode === 'retained-manual')
          await writeFile(join(directory, 'stage-4.json'), JSON.stringify(adopted));
        initializeState(directory);
        const store = fileStore(directory);
        await Effect.runPromise(store.reserve(intent));
        const control: Control = {
          revision: 0,
          cancelled: false,
          claimed: [3],
          restart: { index: 3 },
          ...(mode === 'retained-manual'
            ? {
                manualRepair: {
                  index: 3,
                  threadId: 'thread-live',
                  run: { id: 'run-1', ordinal: 1 },
                  adoption: adopted,
                },
              }
            : {}),
          ...(mode === 'answer'
            ? {
                parked: {
                  index: 3,
                  run: { id: 'run-1', ordinal: 1 },
                  question: { id: 'q', text: 'Which approach?' },
                },
              }
            : {}),
        };
        await Effect.runPromise(store.saveControl(control));
        // Prior unsuccessful fresh attempts occupy earlier immutable journal entries.
        for (let index = 0; index < 3; index++)
          await Effect.runPromise(
            store.saveStage({ ...initial, index, threadId: `old-thread-${index}` })
          );
        const execution: Execution =
          mode === 'answer'
            ? {
                ...adapter,
                // Question transport is covered separately; supply the acknowledged answer fact.
                observe: (intent, request) =>
                  Effect.map(adapter.observe(intent, request), (observation) => ({
                    ...observation,
                    answeredQuestions: ['q'],
                  })),
              }
            : adapter;
        const status = () =>
          Effect.runPromise(
            Effect.flatMap(Job, (job) => job.status()).pipe(
              Effect.provide(
                JobLive.pipe(
                  Layer.provide(
                    Layer.mergeAll(
                      Layer.succeed(JobStore, fileStore(directory)),
                      Layer.succeed(Execution, execution),
                      Layer.succeed(Time, { now: () => Effect.succeed(100) }),
                      Layer.succeed(Issues, {
                        pullRequest: () => Effect.succeed({ kind: 'absent' }),
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
              )
            )
          );
        const prompt = {
          role: 'user',
          text: `Use $implement for ${intent.issueUrl} in this bound checkout against ${intent.base}. Legacy initial launch.`,
        };
        await host.save({
          overrides: { status: 'completed', latestRunId: 'run-1', runCount: 1 },
          messages: [prompt, { role: 'assistant', text: 'Implementation unfinished.' }],
        });
        if (mode === 'manual')
          expect(await status()).toMatchObject({ delivery: { activity: 'manual-recovery' } });
        const receipt = {
          jobId: attempt.id,
          stage: 'implementation',
          base: host.base,
          commit: host.base,
          outcome: '<TASK>COMPLETE</TASK>',
          tests: true,
          coverage: true,
          crap: true,
          reviews: false,
        };
        const complete = (delivery: string | undefined) =>
          host.save({
            overrides: { status: 'completed', latestRunId: 'manual-2', runCount: 2 },
            messages: [
              prompt,
              { role: 'user', text: 'Finish this existing implementation.' },
              {
                role: 'assistant',
                runId: 'manual-2',
                text: JSON.stringify({ ...receipt, ...(delivery ? { delivery } : {}) }),
              },
            ],
          });
        await complete(`${attempt.id}:3`);
        if (mode !== 'retained-manual') await status();
        expect(await status()).toMatchObject({
          delivery: { stage: 'implementation', ready: false },
        });
        await complete(explicit ? `${attempt.id}:0` : undefined);
        expect(await status()).toMatchObject({ delivery: { stage: 'review', ready: false } });
        expect(await readFile(join(directory, 'stage-3.json'), 'utf8')).toBe(original);
        expect(await Effect.runPromise(fileStore(directory).readStage(3))).toEqual(initial);
        if (mode === 'retained-manual')
          expect(await Effect.runPromise(fileStore(directory).readStage(4))).toEqual(adopted);
        expect(
          (await host.calls()).filter(
            (call) => call.args[1] === 'send' && !call.args.includes('--help')
          )
        ).toHaveLength(1);
      } finally {
        if (previous === undefined) delete process.env.FACTORY_FIXTURE;
        else process.env.FACTORY_FIXTURE = previous;
        await host.cleanup();
      }
    }
  );
}
