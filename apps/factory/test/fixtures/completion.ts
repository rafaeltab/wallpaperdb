import { Effect, Layer, ManagedRuntime } from 'effect';
import {
  AgentReconciliationPolicy,
  Execution,
  Issues,
  Job,
  JobLive,
  JobStore,
  Time,
  Unavailable,
  type StageRequest,
  type StageEvidence,
} from '../../src/capabilities/job/index.js';
import { controlledStore } from './store.js';

export async function completionFixture(limit = 3, store: JobStore = controlledStore()) {
  let accepted = false;
  let idle = false;
  let observationStatus: string | undefined;
  let migrationRequired: boolean | undefined = false;
  let dependencies: readonly string[] | undefined;
  let clean = true;
  let run = 1;
  let commit = 'b'.repeat(40);
  let prCommit = commit;
  let ready = false;
  let dependencyResult: 'valid' | 'invalid' | 'cycle' = 'valid';
  let handbackVerified = false;
  let lost = false;
  const sends: StageRequest[] = [];
  const runtime = ManagedRuntime.make(
    JobLive.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(JobStore, store),
          Layer.succeed(Time, { now: () => Effect.succeed(100) }),
          Layer.succeed(AgentReconciliationPolicy, { limit }),
          Layer.succeed(Issues, {
            validateDependencies: () => Effect.succeed(dependencyResult),
            verifyHandback: () => Effect.succeed(handbackVerified),
            inspect: () =>
              Effect.succeed({
                open: true,
                author: 'rafaeltab',
                labels: ['ready-for-agent'],
                blockers: [],
                blockersReady: true,
                url: 'https://github.com/rafaeltab/wallpaperdb/issues/757',
              }),
            pullRequest: () =>
              Effect.succeed({
                kind: 'found' as const,
                url: 'https://github.com/rafaeltab/wallpaperdb/pull/999',
                commit: prCommit,
                ready,
                landed: false,
              }),
          }),
          Layer.succeed(Execution, {
            launch: () => Effect.succeed({ kind: 'submitted' as const }),
            interrupt: () => Effect.void,
            observe: (intent) =>
              Effect.succeed({
                kind: 'found' as const,
                threadId: 'owner',
                status: observationStatus ?? (idle ? 'completed' : 'running'),
                run: { id: `run-${run}`, ordinal: run },
                worktree: '/owner',
                branch: intent.branch,
                model: 'gpt-6.1-sol',
              }),
            inspectStage: (_intent, stage) =>
              Effect.succeed({
                runId: `run-${run}`,
                ordinal: run,
                stageIndex: stage.index,
                commit,
                accepted,
                idle,
                migrationRequired,
                dependencies,
                worktreeClean: clean,
                linked: ['https://github.com/rafaeltab/wallpaperdb/pull/999'],
              } satisfies StageEvidence),
            sendStage: (_intent, stage) =>
              Effect.sync(() => {
                sends.push(stage);
                run++;
                accepted = false;
                idle = false;
              }).pipe(
                Effect.andThen(() =>
                  lost
                    ? Effect.fail(
                        new Unavailable({
                          operation: 'deliver-stage-uncertain',
                          cause: 'lost response',
                        })
                      )
                    : Effect.void
                )
              ),
          })
        )
      )
    )
  );
  const call = <A>(
    fn: (job: import('../../src/capabilities/job/index.js').Job) => Effect.Effect<A, unknown>
  ) => runtime.runPromise(Effect.flatMap(Job, fn));
  await call((job) => job.start({ issue: 757, base: 'a'.repeat(40), context: 'issue only' }));
  return {
    store,
    sends,
    status: () => call((job) => job.status()),
    close: () => runtime.dispose(),
    resume: (command: import('../../src/capabilities/job/index.js').Resume) =>
      call((job) => job.resume(command)),
    cancel: (id: string) => call((job) => job.cancel(id)),
    state: (change: {
      accepted?: boolean;
      idle?: boolean;
      migrationRequired?: boolean;
      dependencies?: readonly string[];
      commit?: string;
      prCommit?: string;
      ready?: boolean;
      clean?: boolean;
      lost?: boolean;
      run?: number;
      observationStatus?: string;
      dependencyResult?: 'valid' | 'invalid' | 'cycle';
      handbackVerified?: boolean;
    }) => {
      dependencyResult = change.dependencyResult ?? dependencyResult;
      handbackVerified = change.handbackVerified ?? handbackVerified;
      accepted = change.accepted ?? accepted;
      idle = change.idle ?? idle;
      if ('migrationRequired' in change) migrationRequired = change.migrationRequired;
      dependencies = change.dependencies ?? dependencies;
      commit = change.commit ?? commit;
      prCommit = change.prCommit ?? prCommit;
      ready = change.ready ?? ready;
      clean = change.clean ?? clean;
      lost = change.lost ?? lost;
      run = change.run ?? run;
      observationStatus = change.observationStatus ?? observationStatus;
    },
  };
}
