import { ExecutionConfiguration } from '../capabilities/job/index.js';
import {
  Reporting,
  ReportingStore,
  ReportingLive,
  JobReportingLive,
  Threads,
  ThreadsLive,
  ThreadSource,
  ThreadStore,
  Observations,
  ObservationsLive,
  ObservationStore,
  ObservationCheckpoints,
  ObservationSource,
  LocalSnapshot,
} from '../capabilities/observe/index.js';
import { resolve } from 'node:path';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { z } from 'zod';
import {
  AgentReconciliationPolicy,
  defaultAgentReconciliationLimit,
  JobReporting,
  Execution,
  ContinuationAdmission,
  Issues,
  Job,
  JobLive,
  eligible,
  JobStore,
  Time,
  Unavailable,
  type Status,
  type RecoveryAdmission,
} from '../capabilities/job/index.js';
import { systemTime } from '../adapters/clock/index.js';
import {
  fileStore,
  fileScheduleStore,
  jobStateDirectory,
  sqliteAttemptStore,
  sqliteThreads,
  sqliteObservations,
  sqliteLocalSnapshot,
  sqliteScheduleObservations,
  sqlitePlanningSafety,
  sqliteObservationCheckpoints,
} from '../adapters/store/index.js';
import {
  Attempts,
  AttemptsLive,
  AttemptStore,
  PlanLive,
  Plan,
  PlanningDiscovery,
  PlanningDiscoveryLive,
  PlanningSource,
  IPlanner,
  Scheduler,
  SchedulerLive,
  capacityOccupied,
  JobPool,
  ScheduleStore,
  ScheduleObservations,
  PlanningSafety,
  PlanningSafetyLive,
  PlanningSafetyStore,
} from '../capabilities/plan/index.js';
import {
  githubIssues,
  githubPlanning,
  githubObservations,
  githubRequests,
  type VerifiedPrerequisite,
} from '../adapters/github/index.js';
import {
  t3Metadata,
  t3Execution,
  t3Planner,
  t3ExecutionConfiguration,
  t3Observations,
  t3ObserverCredential,
} from '../adapters/t3/index.js';
import { operationsServer } from '../http/index.js';
import { command, stateDirectory } from '../platform/index.js';
import { telemetry } from './telemetry.js';
import { v2Producer } from './v2.js';
import { planningWorker } from './planning.js';
import { observationWorker, inventoryWorker } from './refresh.js';
import { compatibleState } from './state.js';
import { availabilityObservation, retainedWorkAvailable } from './availability.js';

const httpUrl = z
  .string()
  .url()
  .refine((value) => {
    try {
      return ['http:', 'https:'].includes(new URL(value).protocol);
    } catch {
      return false;
    }
  }, 'Expected an HTTP or HTTPS URL');

export async function startFactory(environment: NodeJS.ProcessEnv) {
  const configuration = z
    .object({
      FACTORY_AGENT_RECONCILIATION_LIMIT: z.coerce
        .number()
        .int()
        .min(0)
        .max(100)
        .default(defaultAgentReconciliationLimit),
      FACTORY_PROJECT: z.string().min(1),
      FACTORY_OTEL_ENDPOINT: z
        .string()
        .url()
        .refine((value) => /^https?:/.test(value))
        .optional(),
      FACTORY_T3_MCP_ENDPOINT: httpUrl.optional(),
      FACTORY_T3_OBSERVER_ORIGIN: httpUrl.optional(),
      FACTORY_T3_AUTH_BASE_DIR: z.string().startsWith('/').optional(),
      FACTORY_T3_MCP_AUTHORIZATION_FILE: z.string().startsWith('/').optional(),
      FACTORY_T3_CONNECT_ORIGIN: z
        .string()
        .url()
        .refine((value) => {
          const url = new URL(value);
          return (
            url.protocol === 'https:' &&
            !url.username &&
            !url.password &&
            url.pathname === '/' &&
            !url.search &&
            !url.hash
          );
        })
        .optional(),
      FACTORY_T3_PROJECT_ID: z.string().min(1),
      FACTORY_PR_BASE: z
        .string()
        .regex(/^[A-Za-z0-9][A-Za-z0-9/_.-]*$/)
        .default('main'),
      FACTORY_BASE: z.string().regex(/^[a-f0-9]{40}$/),
      FACTORY_T3_BINARY: z.string().startsWith('/'),
      FACTORY_STATE: z.string().startsWith('/'),
      FACTORY_HOST: z
        .string()
        .ip()
        .default('127.0.0.1')
        .refine(
          (host) =>
            host === '127.0.0.1' ||
            host === '::1' ||
            /^100\.(6[4-9]|[789]\d|1[01]\d|12[0-7])\./.test(host)
        ),
      FACTORY_PORT: z.coerce
        .number()
        .int()
        .min(0)
        .max(65535)
        .refine((port) => port === 0 || port >= 1024)
        .default(9400),
      FACTORY_PREREQUISITES: z
        .string()
        .default('[]')
        .transform((text) => JSON.parse(text))
        .pipe(
          z.array(
            z.object({
              issue: z.number().int().positive(),
              pr: z.number().int().positive(),
              commit: z.string().regex(/^[a-f0-9]{40}$/),
              context: z.string().optional(),
              owningThreadId: z.string().min(1).optional(),
            })
          )
        ),
    })
    .parse(environment);
  configuration.FACTORY_STATE = stateDirectory(configuration.FACTORY_STATE);
  await compatibleState(configuration.FACTORY_STATE);
  const project = resolve(configuration.FACTORY_PROJECT);
  const requests = new AbortController();
  const startupCleanup: Array<() => Promise<unknown>> = [];
  try {
    const observability = telemetry(configuration.FACTORY_OTEL_ENDPOINT);
    const observerRuntime = ManagedRuntime.make(
      Layer.mergeAll(
        observability,
        Layer.succeed(
          ObservationCheckpoints,
          sqliteObservationCheckpoints(configuration.FACTORY_STATE)
        )
      )
    );
    startupCleanup.push(() => observerRuntime.dispose());
    const github = githubRequests({
      project,
      directory: configuration.FACTORY_STATE,
      signal: requests.signal,
    });
    startupCleanup.push(() => github.drain());
    await command('git', ['cat-file', '-e', `${configuration.FACTORY_BASE}^{commit}`], project);
    const help = await command(
      configuration.FACTORY_T3_BINARY,
      ['thread', 'start', '--help'],
      project
    );
    if (!help.includes('--worktree') || !help.includes('--model'))
      throw new Error('T3 installation lacks required headless thread interface');
    const observerEndpoint =
      configuration.FACTORY_T3_OBSERVER_ORIGIN ?? configuration.FACTORY_T3_MCP_ENDPOINT;
    if (!observerEndpoint)
      throw new Error('Configure FACTORY_T3_OBSERVER_ORIGIN or FACTORY_T3_MCP_ENDPOINT');
    const observerOrigin = new URL(observerEndpoint).origin;
    const observerReport = (cause: unknown) => {
      void Effect.runPromise(
        Effect.logError(new Unavailable({ operation: 'background-t3-observation', cause }))
      );
    };
    const executionObservations = await t3Observations({
      run: (operation) => observerRuntime.runPromise(operation),
      origin: observerOrigin,
      checkpoints: await observerRuntime.runPromise(ObservationCheckpoints),
      credential: t3ObserverCredential({
        binary: configuration.FACTORY_T3_BINARY,
        project,
        directory: resolve(configuration.FACTORY_STATE, 'observer'),
        origin: observerOrigin,
        authBaseDir: configuration.FACTORY_T3_AUTH_BASE_DIR,
        report: observerReport,
      }),
      report: observerReport,
    });
    startupCleanup.push(() => executionObservations.close());
    const readyPrerequisites = () =>
      Effect.gen(function* () {
        const result: VerifiedPrerequisite[] = [];
        for (const admission of (yield* scheduleStore.read()).admissions) {
          const assertion = readyAssertion(yield* (yield* pool.job(admission.issue)).status());
          if (assertion) result.push(assertion);
        }
        return result;
      });
    let recoveryAdmission: RecoveryAdmission = () => Effect.succeed(false);
    const metadataGithub = (args: readonly string[], signal?: AbortSignal) =>
      github(args, signal, 'background');
    const githubConfig = (
      read: Parameters<typeof githubIssues>[0]['read'] = github,
      prerequisites = readyPrerequisites
    ): Parameters<typeof githubIssues>[0] => ({
      project,
      read,
      prBase: configuration.FACTORY_PR_BASE,
      base: configuration.FACTORY_BASE,
      prerequisites: configuration.FACTORY_PREREQUISITES,
      readyPrerequisites: prerequisites,
      admitRecovery: (issue) => recoveryAdmission(issue),
      joins: {
        observations: executionObservations,
        readExecution: async () => (await runtime.runPromise(scheduleStore.read())).execution,
        reconciliationLimit: configuration.FACTORY_AGENT_RECONCILIATION_LIMIT,
        directory: resolve(configuration.FACTORY_STATE, 'joins'),
        binary: configuration.FACTORY_T3_BINARY,
        projectId: configuration.FACTORY_T3_PROJECT_ID,
        mcpEndpoint: configuration.FACTORY_T3_MCP_ENDPOINT,
        mcpAuthorizationFile: configuration.FACTORY_T3_MCP_AUTHORIZATION_FILE,
      },
    });
    const observationStore = sqliteObservations(configuration.FACTORY_STATE);
    const reportingRuntime = ManagedRuntime.make(
      JobReportingLive.pipe(
        Layer.provideMerge(
          ReportingLive.pipe(Layer.provide(Layer.succeed(ReportingStore, observationStore)))
        ),
        Layer.provide(Layer.succeed(Time, systemTime))
      )
    );
    startupCleanup.push(() => reportingRuntime.dispose());
    const reporting = await reportingRuntime.runPromise(Reporting);
    const jobReporting = await reportingRuntime.runPromise(JobReporting);
    const jobDeps = (directory: string) =>
      Layer.mergeAll(
        Layer.succeed(Time, systemTime),
        Layer.succeed(JobReporting, jobReporting),
        Layer.succeed(JobStore, fileStore(directory)),
        Layer.succeed(Issues, githubIssues(githubConfig())),
        Layer.succeed(ContinuationAdmission, {
          authorize: (issue, receipt) => recoveryAdmission(issue, receipt),
        }),
        Layer.succeed(
          Execution,
          t3Execution({
            observations: executionObservations,
            project,
            prBase: configuration.FACTORY_PR_BASE,
            projectId: configuration.FACTORY_T3_PROJECT_ID,
            mcpEndpoint: configuration.FACTORY_T3_MCP_ENDPOINT,
            mcpAuthorizationFile: configuration.FACTORY_T3_MCP_AUTHORIZATION_FILE,
            binary: configuration.FACTORY_T3_BINARY,
          })
        )
      );
    const deps = jobDeps(configuration.FACTORY_STATE);
    const jobLayer = JobLive.pipe(
      Layer.provide(
        Layer.succeed(AgentReconciliationPolicy, {
          limit: configuration.FACTORY_AGENT_RECONCILIATION_LIMIT,
        })
      ),
      Layer.provide(deps)
    );
    const scheduleStore = fileScheduleStore(configuration.FACTORY_STATE);
    const workers = new Map<string, ManagedRuntime.ManagedRuntime<Job, never>>();
    startupCleanup.push(async () => {
      const outcomes = await Promise.allSettled(
        [...workers.values()].map((worker) => worker.dispose())
      );
      const failures = outcomes.flatMap((outcome) =>
        outcome.status === 'rejected' ? [outcome.reason] : []
      );
      if (failures.length) throw new AggregateError(failures, 'Factory worker cleanup failed');
    });
    const legacy = await adoptLegacy(configuration.FACTORY_STATE, scheduleStore);
    const retained = await Effect.runPromise(
      sqliteLocalSnapshot(configuration.FACTORY_STATE).read()
    );
    for (const entry of retained.entries)
      if (entry.intent) {
        executionObservations.retainJob(
          entry.intent.issue,
          entry.intent.id,
          entry.control.ownership?.threadId
        );
        if (entry.control.manualRepair?.threadId)
          executionObservations.retainForIssue(
            entry.intent.issue,
            entry.control.manualRepair.threadId
          );
      }
    let rootIssue = legacy?.issue;
    const pool: JobPool = {
      job: (issue) =>
        Effect.tryPromise({
          try: async () => {
            const admission = (await Effect.runPromise(scheduleStore.read())).admissions.find(
              (item) => item.issue === issue
            );
            const generation = admission?.generation ?? 0;
            const key = `${issue}:${generation}`;
            let worker = workers.get(key);
            if (!worker) {
              rootIssue ??= issue;
              worker = ManagedRuntime.make(
                JobLive.pipe(
                  Layer.provide(
                    Layer.succeed(AgentReconciliationPolicy, {
                      limit: configuration.FACTORY_AGENT_RECONCILIATION_LIMIT,
                    })
                  ),
                  Layer.provide(
                    jobDeps(
                      jobStateDirectory(configuration.FACTORY_STATE, issue, generation, rootIssue)
                    )
                  )
                )
              );
              workers.set(key, worker);
            }
            return worker.runPromise(Job);
          },
          catch: (cause) => new Unavailable({ operation: 'job-runtime', cause }),
        }),
    };

    const executionConfiguration = t3ExecutionConfiguration({
      project,
      binary: configuration.FACTORY_T3_BINARY,
      projectId: configuration.FACTORY_T3_PROJECT_ID,
      mcpEndpoint: configuration.FACTORY_T3_MCP_ENDPOINT,
      mcpAuthorizationFile: configuration.FACTORY_T3_MCP_AUTHORIZATION_FILE,
    });
    let executionCatalog: import('../capabilities/job/index.js').ExecutionCatalog | undefined;
    const refreshExecutionCatalog = Effect.flatMap(scheduleStore.read(), (state) =>
      executionConfiguration.catalog(state.execution?.model)
    ).pipe(
      Effect.tap((value) =>
        Effect.sync(() => {
          executionCatalog = value;
        })
      ),
      Effect.asVoid,
      Effect.catch(() =>
        Effect.sync(() => {
          executionCatalog = undefined;
        })
      )
    );
    const schedulerDeps = Layer.mergeAll(
      Layer.succeed(ExecutionConfiguration, executionConfiguration),
      deps,
      PlanningSafetyLive.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(PlanningSafetyStore, sqlitePlanningSafety(configuration.FACTORY_STATE)),
            Layer.succeed(Time, systemTime)
          )
        )
      ),
      Layer.succeed(ScheduleStore, scheduleStore),
      Layer.succeed(
        ScheduleObservations,
        sqliteScheduleObservations(configuration.FACTORY_STATE, systemTime)
      ),
      Layer.succeed(JobPool, pool)
    );
    let planningDemand = () => {};
    const planner = t3Planner({
      readExecution: async () => (await runtime.runPromise(scheduleStore.read())).execution,
      automaticPolicy: {
        mayLaunch: () =>
          runtime.runPromise(Effect.flatMap(PlanningSafety, (safety) => safety.mayLaunch())),
        failed: (failure) =>
          runtime.runPromise(Effect.flatMap(PlanningSafety, (safety) => safety.failed(failure))),
      },
      mcpEndpoint: configuration.FACTORY_T3_MCP_ENDPOINT,
      mcpAuthorizationFile: configuration.FACTORY_T3_MCP_AUTHORIZATION_FILE,
      stateDirectory: resolve(configuration.FACTORY_STATE, 'planner'),
      project,
      binary: configuration.FACTORY_T3_BINARY,
      projectId: configuration.FACTORY_T3_PROJECT_ID,
    });
    const planningDeps = Layer.mergeAll(
      Layer.succeed(ScheduleStore, scheduleStore),
      Layer.effect(
        PlanningSource,
        Effect.map(Job, (job) => {
          // Scheduled planning observes current generations through the pool below.
          const source = githubPlanning(
            githubConfig(),
            { ...job, status: () => Effect.succeed({ kind: 'empty' as const }) },
            () =>
              Effect.map(scheduleStore.read(), (state) =>
                state.admissions.map((item) => item.issue)
              )
          );
          const issueSource = githubIssues(githubConfig());
          const read = () =>
            Effect.gen(function* () {
              yield* Effect.sync(() => planningDemand());
              const input = yield* source.read();
              const state = yield* scheduleStore.read();
              const jobs = [];
              for (const admission of state.admissions)
                jobs.push(yield* (yield* pool.job(admission.issue)).status());
              return {
                ...input,
                jobs,
                maximumSelections: Math.max(
                  0,
                  Math.min(
                    state.allowance === -1 ? Infinity : state.allowance - state.admissions.length,
                    state.concurrency === -1
                      ? Infinity
                      : state.concurrency -
                          capacityOccupied({
                            state,
                            jobs,
                            recoveries: yield* issueSource.recoveries?.() ?? Effect.succeed([]),
                          })
                  )
                ),
                scheduleRevision: state.revision,
                admissions: state.admissions.map((a) => a.issue),
                paused: state.paused,
                capacity: { concurrency: state.concurrency, admission: state.allowance },
              };
            });
          return {
            verify: source.verify,
            read,
            // The automatic tick owns cycle admission. Its own reconciliation
            // costs must not reject the discovery that follows in that cycle.
            poll: read,
          };
        })
      ),
      Layer.succeed(IPlanner, planner)
    ).pipe(Layer.provideMerge(jobLayer));
    const observationLayer = ObservationsLive.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(Time, systemTime),
          Layer.succeed(Reporting, reporting),
          Layer.succeed(ObservationStore, observationStore),
          Layer.succeed(LocalSnapshot, sqliteLocalSnapshot(configuration.FACTORY_STATE)),
          Layer.succeed(
            ObservationSource,
            githubObservations(
              project,
              () =>
                Effect.map(scheduleStore.read(), (state) => state.admissions.map((a) => a.issue)),
              Effect.gen(function* () {
                const prerequisites = yield* Effect.cached(readyPrerequisites());
                const issues = githubIssues(githubConfig(metadataGithub, () => prerequisites));
                return (number: number) =>
                  Effect.gen(function* () {
                    const observed = yield* issues.inspect(number);
                    return {
                      allowed: eligible(observed),
                      blockersReady: observed.blockersReady,
                      verifiedAt: yield* systemTime.now(),
                      evidence: observed.prerequisite?.evidence,
                    };
                  });
              }),
              metadataGithub,
              { directory: configuration.FACTORY_STATE }
            )
          )
        )
      )
    );
    const threadLayer = ThreadsLive.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(Time, systemTime),
          Layer.succeed(LocalSnapshot, sqliteLocalSnapshot(configuration.FACTORY_STATE)),
          Layer.succeed(Reporting, reporting),
          Layer.succeed(ObservationStore, observationStore),
          Layer.succeed(ThreadStore, sqliteThreads(configuration.FACTORY_STATE)),
          Layer.succeed(
            ThreadSource,
            t3Metadata({
              binary: configuration.FACTORY_T3_BINARY,
              project,
              projectId: configuration.FACTORY_T3_PROJECT_ID,
              mcpEndpoint: configuration.FACTORY_T3_MCP_ENDPOINT,
              mcpAuthorizationFile: configuration.FACTORY_T3_MCP_AUTHORIZATION_FILE,
            })
          )
        )
      )
    );
    const runtime = ManagedRuntime.make(
      SchedulerLive.pipe(
        Layer.provideMerge(
          AttemptsLive.pipe(
            Layer.provideMerge(
              PlanLive.pipe(
                Layer.provideMerge(PlanningDiscoveryLive.pipe(Layer.provideMerge(planningDeps)))
              )
            ),
            Layer.provide(
              Layer.succeed(AttemptStore, sqliteAttemptStore(configuration.FACTORY_STATE))
            )
          )
        ),
        Layer.provideMerge(schedulerDeps),
        Layer.provideMerge(observationLayer),
        Layer.provideMerge(threadLayer),
        Layer.provideMerge(observability)
      ),
      { memoMap: observerRuntime.memoMap }
    );
    startupCleanup.push(() => runtime.dispose());
    const scheduler = await runtime.runPromise(Scheduler);
    const discovery = await runtime.runPromise(PlanningDiscovery);
    const planningSafety = await runtime.runPromise(PlanningSafety);
    recoveryAdmission = scheduler.authorizeRecovery;
    const job: Job = {
      retry: (command) =>
        Effect.flatMap(scheduler.status(), (snapshot) =>
          scheduler.retry(command, snapshot.state.revision)
        ),
      status: () =>
        Effect.map(scheduler.status(), (value) => value.jobs[0] ?? { kind: 'empty' as const }),
      start: (command) => scheduler.start(command),
      resume: (command) => scheduler.resume(command),
      cancel: (id) => scheduler.cancel(id),
    };
    const observations = await runtime.runPromise(Observations);
    const threadService = await runtime.runPromise(Threads);
    const threads = {
      ...threadService,
      snapshot: () =>
        Effect.map(threadService.snapshot(), (value) => ({
          ...value,
          browserOrigin: configuration.FACTORY_T3_CONNECT_ORIGIN,
        })),
    };
    const inventory = inventoryWorker(() =>
      runtime.runPromise(threads.refresh().pipe(Effect.catch(Effect.logError)), {
        signal: requests.signal,
      })
    );
    startupCleanup.push(() => inventory.close());
    let observing: Promise<unknown> | undefined;
    let recoveringPlanner: Promise<unknown> | undefined;
    let automaticCycles = 0;
    let metadataAfterCycle = -1;
    let metadataWaiting = false;
    const refreshes = observationWorker(() =>
      runtime.runPromise(
        Effect.all(
          [
            Effect.suspend(() => {
              if (metadataAfterCycle === automaticCycles) return Effect.void;
              // One initial collection is allowed. Subsequent metadata must give
              // the automatic scheduler an opportunity before taking quota again.
              metadataAfterCycle = automaticCycles;
              // Reserve the next quota turn instead of losing it to the one-second scheduler.
              metadataWaiting = true;
              return Effect.tryPromise({
                try: (signal) => github.waitForCycle(signal),
                catch: (cause) => new Unavailable({ operation: 'metadata-quota', cause }),
              }).pipe(
                Effect.ensuring(
                  Effect.sync(() => {
                    metadataWaiting = false;
                  })
                ),
                Effect.andThen(observations.refresh())
              );
            }),
            refreshExecutionCatalog,
          ],
          { concurrency: 2 }
        ).pipe(Effect.asVoid, Effect.catch(Effect.logError)),
        { signal: requests.signal }
      )
    );
    startupCleanup.push(() => refreshes.close());
    planningDemand = refreshes.demand;
    const attempts = await planningWorker({
      attempts: await runtime.runPromise(Attempts),
      run: (effect) => runtime.runPromise(effect, { signal: requests.signal }),
    });
    startupCleanup.push(() => attempts.close());
    const plan = await runtime.runPromise(Plan);
    const v2 = await v2Producer({
      runSync: (effect) => runtime.runSync(effect),
      planner: await runtime.runPromise(IPlanner),
      directory: configuration.FACTORY_STATE,
      scopeId: 'rafaeltab/wallpaperdb:' + configuration.FACTORY_T3_PROJECT_ID,
      base: configuration.FACTORY_BASE,
      scheduler,
      planningSafety,
      read: () =>
        Effect.all({
          reconciliation: jobReporting.investigations?.() ?? Effect.succeed([]),
          executionCatalog: Effect.sync(() => executionCatalog),
          schedule: observations.schedule(),
          threads: threads.snapshot(),
          safety: planningSafety.status(),
          planningOwner: planner.ownership(false),
          planningVerification: plan.verification(),
          planningDiscovery: discovery.snapshot(),
        }).pipe(
          Effect.map(
            ({
              schedule,
              reconciliation,
              threads,
              safety,
              executionCatalog,
              planningOwner,
              planningVerification,
              planningDiscovery,
            }) => ({
              planningVerification,
              reconciliation,
              executionCatalog,
              ...schedule,
              planningDiscovery,
              coordinationIdle:
                !observing &&
                !recoveringPlanner &&
                attempts.isIdle() &&
                (!planningOwner || planningOwner.retired === true),
              state: safety.schedule,
              planningSafety: safety.planning,
              threads: { ...threads, browserOrigin: configuration.FACTORY_T3_CONNECT_ORIGIN },
            })
          )
        ),
      submitPlan: (parent) => attempts.submit(parent),
      observePlan: async (id) => (await attempts.observe(id))?.launch,
      run: (effect) => runtime.runPromise(effect, { signal: requests.signal }),
    });
    startupCleanup.push(() => v2.close());
    const app = operationsServer({
      clientActivity: refreshes.client,
      v2: v2.data,
      threads: threads.snapshot,
      base: configuration.FACTORY_BASE,
      job,
      scheduler,
      snapshot: () =>
        Effect.all({ schedule: observations.schedule(), threads: threads.snapshot() }).pipe(
          Effect.map(({ schedule, threads }) => ({ ...schedule, threads }))
        ),
      attempts,
      run: (effect) => runtime.runPromise(effect, { signal: requests.signal }),
    });
    startupCleanup.push(() => app.close());
    await runtime.runPromise(
      Effect.tryPromise(() =>
        app.listen({ host: configuration.FACTORY_HOST, port: configuration.FACTORY_PORT })
      ).pipe(Effect.withSpan('factory.startup'))
    );

    // Owned model deadlines and terminal cleanup continue independently of admissions
    // and quota-paced GitHub discovery. This worker can only reconcile an existing run.
    const plannerTimer = setInterval(() => {
      if (recoveringPlanner) return;
      recoveringPlanner = runtime
        .runPromise(planner.reconcile(), { signal: requests.signal })
        .finally(() => {
          recoveringPlanner = undefined;
        });
      void recoveringPlanner.catch(() => undefined);
    }, 1000);
    startupCleanup.push(async () => {
      clearInterval(plannerTimer);
    });
    const observationTimer = setInterval(() => {
      if (observing || metadataWaiting || !github.cycleReady()) return;
      automaticCycles++;
      observing = runtime
        .runPromise(
          scheduler.tick(configuration.FACTORY_BASE).pipe(
            Effect.tap((snapshot) =>
              configuration.FACTORY_OTEL_ENDPOINT
                ? availabilityObservation(retainedWorkAvailable(snapshot))
                : Effect.void
            ),
            Effect.catch((error) =>
              (configuration.FACTORY_OTEL_ENDPOINT
                ? availabilityObservation(false)
                : Effect.void
              ).pipe(Effect.andThen(Effect.logError(error)))
            )
          ),
          {
            signal: requests.signal,
          }
        )
        .finally(() => {
          observing = undefined;
        });
      void observing.catch(() => undefined);
    }, 1000);
    startupCleanup.push(async () => {
      clearInterval(observationTimer);
    });
    let closing: Promise<void> | undefined;
    const close = () =>
      (closing ??= (async () => {
        clearInterval(observationTimer);
        clearInterval(plannerTimer);
        // Reserve the remaining shutdown budget for bounded exporter disposal.
        const deadline = setTimeout(() => {
          requests.abort();
          app.server.closeAllConnections();
        }, 3000);
        try {
          await app.close();
        } finally {
          try {
            await Promise.allSettled([
              v2.close(),
              attempts.close(),
              observing,
              recoveringPlanner,
              refreshes.close(),
              inventory.close(),
              executionObservations.close(),
            ]);
          } finally {
            clearTimeout(deadline);
            requests.abort();
            await Promise.allSettled([
              github.drain(),
              runtime.dispose(),
              observerRuntime.dispose(),
              ...[...workers.values()].map((worker) => worker.dispose()),
            ]);
            await reportingRuntime.dispose();
          }
        }
      })());
    startupCleanup.length = 0;
    return { app, close };
  } catch (cause) {
    requests.abort();
    const failures: unknown[] = [];
    for (const release of startupCleanup.reverse()) {
      try {
        await release();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length)
      throw new AggregateError([cause, ...failures], 'Factory startup and resource cleanup failed');
    throw cause;
  }
}

function readyAssertion(status: Status): VerifiedPrerequisite | null {
  if (status.kind !== 'job') return null;
  const pr = status.prerequisite;
  if (!pr) return null;
  return {
    issue: status.intent.issue,
    pr: Number(pr.url.split('/').at(-1)),
    commit: pr.commit,
    parent: pr.parent ?? status.intent.base,
    branch: status.intent.branch,
    prBase: pr.base ?? status.intent.prBase,
    reviewedCommit: pr.reviewedCommit,
    context: status.intent.context,
    owningThreadId: status.execution.kind === 'found' ? status.execution.threadId : undefined,
  };
}

async function adoptLegacy(directory: string, scheduleStore: ScheduleStore) {
  const legacy = await Effect.runPromise(fileStore(directory).read());
  if (legacy) {
    const state = await Effect.runPromise(scheduleStore.read());
    if (
      !state.admissions.some((a) => a.issue === legacy.issue) &&
      !state.released?.some((item) => item.jobId === legacy.id)
    )
      await Effect.runPromise(
        scheduleStore.save({
          ...state,
          revision: state.revision + 1,
          admissions: [
            ...state.admissions,
            {
              issue: legacy.issue,
              base: legacy.base,
              context: legacy.context,
              prBase: legacy.prBase,
              prerequisiteEvidence: legacy.prerequisiteEvidence,
            },
          ],
        })
      );
  }
  return legacy;
}
