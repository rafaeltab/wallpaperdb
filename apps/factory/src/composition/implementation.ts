import { resolve } from 'node:path';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { z } from 'zod';
import {
  Execution,
  Issues,
  Job,
  JobLive,
  JobStore,
  Time,
  Unavailable,
  type Status,
  type RecoveryAdmission,
} from '../capabilities/job/index.js';
import { systemTime } from '../adapters/clock/index.js';
import { fileStore, fileScheduleStore } from '../adapters/store/index.js';
import {
  Plan,
  PlanLive,
  PlanningSource,
  IPlanner,
  Scheduler,
  SchedulerLive,
  JobPool,
  ScheduleStore,
} from '../capabilities/plan/index.js';
import {
  githubIssues,
  githubPlanning,
  type VerifiedPrerequisite,
} from '../adapters/github/index.js';
import { t3Execution, t3Planner } from '../adapters/t3/index.js';
import { operationsServer } from '../http/index.js';
import { command } from '../platform/index.js';
import { telemetry } from './telemetry.js';

export async function startFactory(environment: NodeJS.ProcessEnv) {
  const configuration = z
    .object({
      FACTORY_PROJECT: z.string().min(1),
      FACTORY_OTEL_ENDPOINT: z
        .string()
        .url()
        .refine((value) => /^https?:/.test(value))
        .optional(),
      FACTORY_T3_MCP_ENDPOINT: z.string().url().optional(),
      FACTORY_T3_MCP_AUTHORIZATION_FILE: z.string().startsWith('/').optional(),
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
  const project = resolve(configuration.FACTORY_PROJECT);
  await command('git', ['cat-file', '-e', `${configuration.FACTORY_BASE}^{commit}`], project);
  const help = await command(
    configuration.FACTORY_T3_BINARY,
    ['thread', 'start', '--help'],
    project
  );
  if (!help.includes('--worktree') || !help.includes('--model'))
    throw new Error('T3 installation lacks required headless thread interface');
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
  const jobDeps = (directory: string) =>
    Layer.mergeAll(
      Layer.succeed(Time, systemTime),
      Layer.succeed(JobStore, fileStore(directory)),
      Layer.succeed(
        Issues,
        githubIssues({
          project,
          prBase: configuration.FACTORY_PR_BASE,
          base: configuration.FACTORY_BASE,
          prerequisites: configuration.FACTORY_PREREQUISITES,
          readyPrerequisites,
          admitRecovery: (issue) => recoveryAdmission(issue),
          joins: {
            directory: resolve(configuration.FACTORY_STATE, 'joins'),
            binary: configuration.FACTORY_T3_BINARY,
            projectId: configuration.FACTORY_T3_PROJECT_ID,
            mcpEndpoint: configuration.FACTORY_T3_MCP_ENDPOINT,
            mcpAuthorizationFile: configuration.FACTORY_T3_MCP_AUTHORIZATION_FILE,
          },
        })
      ),
      Layer.succeed(
        Execution,
        t3Execution({
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
  const jobLayer = JobLive.pipe(Layer.provide(deps));
  const scheduleStore = fileScheduleStore(configuration.FACTORY_STATE);
  const workers = new Map<number, ManagedRuntime.ManagedRuntime<Job, never>>();
  const legacy = await adoptLegacy(configuration.FACTORY_STATE, scheduleStore);
  let rootIssue = legacy?.issue;
  const pool: JobPool = {
    job: (issue) =>
      Effect.tryPromise({
        try: async () => {
          let worker = workers.get(issue);
          if (!worker) {
            rootIssue ??= issue;
            worker = ManagedRuntime.make(
              JobLive.pipe(
                Layer.provide(
                  jobDeps(
                    rootIssue === issue
                      ? configuration.FACTORY_STATE
                      : resolve(configuration.FACTORY_STATE, `issue-${issue}`)
                  )
                )
              )
            );
            workers.set(issue, worker);
          }
          return worker.runPromise(Job);
        },
        catch: (cause) => new Unavailable({ operation: 'job-runtime', cause }),
      }),
  };

  const schedulerDeps = Layer.mergeAll(
    deps,
    Layer.succeed(ScheduleStore, scheduleStore),
    Layer.succeed(JobPool, pool)
  );
  const planningDeps = Layer.mergeAll(
    Layer.effect(
      PlanningSource,
      Effect.map(Job, (job) => {
        const source = githubPlanning(
          {
            project,
            base: configuration.FACTORY_BASE,
            prBase: configuration.FACTORY_PR_BASE,
            prerequisites: configuration.FACTORY_PREREQUISITES,
            readyPrerequisites,
            admitRecovery: (issue) => recoveryAdmission(issue),
            joins: {
              directory: resolve(configuration.FACTORY_STATE, 'joins'),
              binary: configuration.FACTORY_T3_BINARY,
              projectId: configuration.FACTORY_T3_PROJECT_ID,
              mcpEndpoint: configuration.FACTORY_T3_MCP_ENDPOINT,
              mcpAuthorizationFile: configuration.FACTORY_T3_MCP_AUTHORIZATION_FILE,
            },
          },
          job
        );
        return {
          read: () =>
            Effect.gen(function* () {
              const input = yield* source.read();
              const state = yield* scheduleStore.read();
              const jobs = [];
              for (const admission of state.admissions)
                jobs.push(yield* (yield* pool.job(admission.issue)).status());
              return {
                ...input,
                jobs,
                scheduleRevision: state.revision,
                admissions: state.admissions.map((a) => a.issue),
                paused: state.paused,
                capacity: { concurrency: state.concurrency, admission: state.allowance },
              };
            }),
        };
      })
    ),
    Layer.succeed(
      IPlanner,
      t3Planner({
        project,
        binary: configuration.FACTORY_T3_BINARY,
        projectId: configuration.FACTORY_T3_PROJECT_ID,
      })
    )
  ).pipe(Layer.provideMerge(jobLayer));
  const runtime = ManagedRuntime.make(
    SchedulerLive.pipe(
      Layer.provideMerge(PlanLive.pipe(Layer.provideMerge(planningDeps))),
      Layer.provideMerge(schedulerDeps),
      Layer.provideMerge(telemetry(configuration.FACTORY_OTEL_ENDPOINT))
    )
  );
  const scheduler = await runtime.runPromise(Scheduler);
  recoveryAdmission = scheduler.authorizeRecovery;
  const job: Job = {
    status: () =>
      Effect.map(scheduler.status(), (value) => value.jobs[0] ?? { kind: 'empty' as const }),
    start: (command) => scheduler.start(command),
    resume: (command) => scheduler.resume(command),
    cancel: (id) => scheduler.cancel(id),
  };
  const requests = new AbortController();
  const app = operationsServer({
    base: configuration.FACTORY_BASE,
    job,
    scheduler,
    plan: await runtime.runPromise(Plan),
    run: (effect) => runtime.runPromise(effect, { signal: requests.signal }),
  });
  try {
    await runtime.runPromise(
      Effect.tryPromise(() =>
        app.listen({ host: configuration.FACTORY_HOST, port: configuration.FACTORY_PORT })
      ).pipe(Effect.withSpan('factory.startup'))
    );
  } catch (cause) {
    try {
      await app.close();
    } finally {
      requests.abort();
      await runtime.dispose();
      await Promise.all([...workers.values()].map((worker) => worker.dispose()));
    }
    throw cause;
  }

  let observing: Promise<unknown> | undefined;
  const observationTimer = setInterval(() => {
    if (observing) return;
    observing = runtime
      .runPromise(
        scheduler
          .tick(configuration.FACTORY_BASE)
          .pipe(Effect.catch((error) => Effect.logError(error))),
        {
          signal: requests.signal,
        }
      )
      .finally(() => {
        observing = undefined;
      });
    void observing.catch(() => undefined);
  }, 1000);
  let closing: Promise<void> | undefined;
  const close = () =>
    (closing ??= (async () => {
      clearInterval(observationTimer);
      const deadline = setTimeout(() => {
        requests.abort();
        app.server.closeAllConnections();
      }, 5000);
      try {
        await app.close();
      } finally {
        clearTimeout(deadline);
        requests.abort();
        await observing?.catch(() => undefined);
        await runtime.dispose();
        await Promise.all([...workers.values()].map((worker) => worker.dispose()));
      }
    })());
  return { app, close };
}

function readyAssertion(status: Status): VerifiedPrerequisite | null {
  if (status.kind !== 'job' || !(status.delivery?.ready || status.delivery?.landed)) return null;
  const pr = status.delivery.pr;
  if (pr?.kind !== 'found') return null;
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
    if (!state.admissions.some((a) => a.issue === legacy.issue))
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
