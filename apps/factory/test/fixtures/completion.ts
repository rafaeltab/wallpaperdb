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
  JobReporting,
  type StageRequest,
  type StageEvidence,
} from '../../src/capabilities/job/index.js';
import { controlledStore } from './store.js';

export async function completionFixture(
  limit = 3,
  store: JobStore = controlledStore(),
  verified?: () => Effect.Effect<void>,
  reporting?: JobReporting,
  launch?: { threadId: string; discoveryAvailable: boolean }
) {
  let base: string | undefined;
  let unexpectedBase = false;
  let accepted = false;
  let idle = false;
  let observationStatus: string | undefined;
  let migrationRequired: boolean | undefined = false;
  let rejection: StageEvidence['rejection'];
  let dependencies: readonly string[] | undefined;
  let clean = true;
  let run = 1;
  let commit = 'b'.repeat(40);
  let prCommit = commit;
  let ready = false;
  let failed = false;
  let dependencyResult: 'valid' | 'invalid' | 'cycle' = 'valid';
  let handbackVerified = false;
  let lost = false;
  let inspectFailed = false;
  let publicationUnavailable = false;
  const sends: StageRequest[] = [];
  const interrupts: string[] = [];
  const runtime = ManagedRuntime.make(
    JobLive.pipe(
      Layer.provide(
        Layer.mergeAll(
          reporting ? Layer.succeed(JobReporting, reporting) : Layer.empty,
          Layer.succeed(JobStore, store),
          Layer.succeed(Time, { now: () => Effect.succeed(100) }),
          Layer.succeed(AgentReconciliationPolicy, { limit }),
          Layer.succeed(Issues, {
            validateDependencies: () => Effect.succeed(dependencyResult),
            verifyHandback: () =>
              Effect.gen(function* () {
                const result = handbackVerified;
                if (result && verified) yield* verified();
                return result;
              }),
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
              publicationUnavailable
                ? Effect.fail(
                    new Unavailable({ operation: 'observe-publication', cause: 'outage' })
                  )
                : Effect.succeed({
                    kind: 'found' as const,
                    url: 'https://github.com/rafaeltab/wallpaperdb/pull/999',
                    commit: prCommit,
                    ready,
                    landed: false,
                    ...(failed ? { ci: { failed: true, progress: 'Completed failed CI' } } : {}),
                  }),
          }),
          Layer.succeed(Execution, {
            launch: () =>
              Effect.succeed({ kind: 'submitted' as const, threadId: launch?.threadId }),
            interrupt: (_intent, threadId) =>
              Effect.sync(() => {
                interrupts.push(threadId);
              }),
            observe: (intent, stage) =>
              launch && !launch.discoveryAvailable && !stage
                ? Effect.succeed({ kind: 'ambiguous' as const })
                : Effect.succeed({
                    kind: 'found' as const,
                    threadId: 'owner',
                    status: observationStatus ?? (idle ? 'completed' : 'running'),
                    run: { id: `run-${run}`, ordinal: run },
                    worktree: '/owner',
                    branch: intent.branch,
                    model: 'gpt-6.1-sol',
                  }),
            inspectStage: (_intent, stage) =>
              inspectFailed
                ? Effect.fail(
                    new Unavailable({ operation: 'inspect-stage', cause: 'controlled outage' })
                  )
                : Effect.succeed({
                    base,
                    unexpectedBase,
                    runId: `run-${run}`,
                    ordinal: run,
                    stageIndex: stage.index,
                    commit,
                    accepted,
                    idle,
                    migrationRequired,
                    rejection,
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
    interrupts,
    status: () => call((job) => job.status()),
    close: () => runtime.dispose(),
    resume: (command: import('../../src/capabilities/job/index.js').Resume) =>
      call((job) => job.resume(command)),
    cancel: (id: string) => call((job) => job.cancel(id)),
    state: (change: {
      base?: string;
      unexpectedBase?: boolean;
      accepted?: boolean;
      idle?: boolean;
      migrationRequired?: boolean;
      dependencies?: readonly string[];
      commit?: string;
      prCommit?: string;
      ready?: boolean;
      failed?: boolean;
      clean?: boolean;
      rejection?: StageEvidence['rejection'];
      lost?: boolean;
      inspectFailed?: boolean;
      publicationUnavailable?: boolean;
      run?: number;
      observationStatus?: string;
      dependencyResult?: 'valid' | 'invalid' | 'cycle';
      handbackVerified?: boolean;
    }) => {
      base = change.base ?? base;
      unexpectedBase = change.unexpectedBase ?? unexpectedBase;
      dependencyResult = change.dependencyResult ?? dependencyResult;
      handbackVerified = change.handbackVerified ?? handbackVerified;
      accepted = change.accepted ?? accepted;
      idle = change.idle ?? idle;
      if ('migrationRequired' in change) migrationRequired = change.migrationRequired;
      if ('rejection' in change) rejection = change.rejection;
      dependencies = change.dependencies ?? dependencies;
      commit = change.commit ?? commit;
      prCommit = change.prCommit ?? prCommit;
      ready = change.ready ?? ready;
      failed = change.failed ?? failed;
      clean = change.clean ?? clean;
      lost = change.lost ?? lost;
      inspectFailed = change.inspectFailed ?? inspectFailed;
      publicationUnavailable = change.publicationUnavailable ?? publicationUnavailable;
      run = change.run ?? run;
      observationStatus = change.observationStatus ?? observationStatus;
    },
  };
}
