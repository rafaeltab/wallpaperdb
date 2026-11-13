import { randomUUID } from 'node:crypto';
import { Effect, Layer, type Tracer } from 'effect';
import {
  makeBoard,
  BoardStore,
  BoardCommands,
  type BoardCommands as Commands,
  type Action,
  type BoardCommand,
} from '../capabilities/board/index.js';
import { Time, Unavailable } from '../capabilities/job/index.js';
import {
  AttemptStore,
  IPlanner,
  type PlanningSafety,
  type Scheduler,
  type AttemptSubmission,
} from '../capabilities/plan/index.js';
import type { ScheduleSnapshot } from '../capabilities/observe/index.js';
import { sqliteAttemptStore, sqliteBoard } from '../adapters/store/index.js';
import { systemTime } from '../adapters/clock/index.js';
import { liveV2Data } from '../http/index.js';

export async function v2Producer(config: {
  directory: string;
  scopeId: string;
  base: string;
  scheduler: Scheduler;
  planningSafety: PlanningSafety;
  planner: IPlanner;
  read: () => Effect.Effect<ScheduleSnapshot, Unavailable>;
  submitPlan: (parent?: Tracer.Span) => Promise<AttemptSubmission>;
  run: <A>(effect: Effect.Effect<A, Unavailable>) => Promise<A>;
  runSync: <A>(effect: Effect.Effect<A>) => A;
  observePlan: (
    id: string
  ) => Promise<import('../capabilities/plan/index.js').PlannerOwnership | undefined>;
}) {
  const dependencies = Layer.mergeAll(
    Layer.succeed(BoardStore, sqliteBoard(config.directory, config.scopeId)),
    Layer.succeed(BoardCommands, commandAdapter(config)),
    Layer.succeed(Time, systemTime),
    Layer.succeed(AttemptStore, sqliteAttemptStore(config.directory)),
    Layer.succeed(IPlanner, config.planner)
  );
  const run = config.run;
  const attemptStore = sqliteAttemptStore(config.directory);
  const latestPlan = () =>
    Effect.gen(function* () {
      const plan = yield* attemptStore.latest?.() ?? attemptStore.pending();
      if (!plan) return undefined;
      const launch = yield* Effect.tryPromise({
        try: () => config.observePlan(plan.id),
        catch: (cause) => new Unavailable({ operation: 'v2-plan-ownership', cause }),
      });
      return { ...plan, launch };
    });
  const board = await run(
    Effect.flatMap(
      Effect.all({ initial: config.read(), initialPlan: latestPlan() }),
      ({ initial, initialPlan }) =>
        makeBoard({ scopeId: config.scopeId, epoch: randomUUID(), initial, initialPlan })
    ).pipe(Effect.provide(dependencies))
  );
  let publishing: Promise<void> | undefined,
    working: Promise<void> | undefined,
    closed = false;
  const refresh = () => {
    if (publishing || closed) return;
    publishing = run(
      Effect.flatMap(latestPlan(), (plan) =>
        Effect.flatMap(config.read(), (input) => board.publish(input, plan))
      ).pipe(Effect.catch(Effect.logError))
    ).finally(() => {
      publishing = undefined;
    });
    void publishing.catch(() => undefined);
  };
  const queue: { id: string; parent?: Tracer.Span }[] = [];
  let retryAt = 0,
    retryDelay = 1000;
  const pump = () => {
    if (working || closed || Date.now() < retryAt) return;
    const entry = queue[0];
    if (!entry && !board.hasPending()) return;
    const operation = board.processPending(entry?.id).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          if (entry) queue.shift();
          retryAt = 0;
          retryDelay = 1000;
        })
      ),
      Effect.catch((cause) =>
        Effect.sync(() => {
          retryAt = Date.now() + retryDelay;
          retryDelay = Math.min(retryDelay * 2, 30000);
        }).pipe(Effect.andThen(Effect.logError(cause)))
      )
    );
    working = run(
      entry?.parent ? operation.pipe(Effect.withParentSpan(entry.parent)) : operation
    ).finally(() => {
      working = undefined;
      refresh();
      if (queue.length && retryAt === 0) pump();
    });
    void working.catch(() => undefined);
  };
  const timer = setInterval(() => {
    refresh();
    pump();
  }, 1000);
  return {
    data: liveV2Data(
      board,
      run,
      (id, parent) => {
        queue.push({ id, parent });
        pump();
      },
      config.runSync
    ),
    close: async () => {
      closed = true;
      clearInterval(timer);
      board.close();
      await Promise.all([publishing?.catch(() => undefined), working?.catch(() => undefined)]);
    },
  };
}
function commandAdapter(config: {
  base: string;
  scheduler: Scheduler;
  planningSafety: PlanningSafety;
  submitPlan: (parent?: Tracer.Span) => Promise<AttemptSubmission>;
}): Commands {
  const rejected = (code: string, message: string) => ({
    state: 'rejected' as const,
    result: null,
    reasons: [{ code, message }],
  });
  return {
    execute: (command: BoardCommand, action: Action, input: ScheduleSnapshot, targets = {}) =>
      Effect.gen(function* () {
        const { planningNotice, retryTarget } = targets;
        if (command.kind === 'acknowledge-planning-failures') {
          const result = planningNotice
            ? yield* config.planningSafety.acknowledge(planningNotice)
            : 'stale';
          return result === 'saved'
            ? { state: 'succeeded' as const, result: null, reasons: [] }
            : rejected(
                'stale-action',
                'The planning failure notice changed. Refresh before acknowledging it.'
              );
        }
        if (command.kind === 'configure') {
          const result = yield* config.scheduler.configure({
            revision: input.state.controlsRevision ?? input.state.revision,
            paused: command.payload.paused,
            concurrency:
              command.payload.concurrency.kind === 'unlimited'
                ? -1
                : command.payload.concurrency.maximum,
            allowance:
              command.payload.admissionAllowance.kind === 'unlimited'
                ? -1
                : command.payload.admissionAllowance.maximum,
          });
          return result === 'saved'
            ? { state: 'succeeded' as const, result: null, reasons: [] }
            : rejected(
                result,
                result === 'acknowledgement-required'
                  ? 'Acknowledge the planning failures before resuming the factory.'
                  : 'Controls changed or limits were rejected. Refresh the board.'
              );
        }
        if (command.kind === 'preview-plan') {
          const parent = yield* Effect.currentSpan.pipe(
            Effect.catch(() => Effect.succeed(undefined))
          );
          const result = yield* Effect.tryPromise({
            try: () => config.submitPlan(parent),
            catch: (cause) => new Unavailable({ operation: 'v2-preview', cause }),
          });
          return result.kind === 'accepted'
            ? {
                state: 'succeeded' as const,
                result: { planId: `plan:${result.id}` as const },
                reasons: [],
              }
            : rejected(
                result.kind,
                'Planning ownership prevents another preview. Observe the existing attempt.'
              );
        }
        if (command.kind === 'start') {
          const issue = Object.values(input.observations.facts?.issues ?? []).find(
            (i) => `issue:rafaeltab/wallpaperdb/${i.number}` === action.targetId
          );
          if (!issue) return rejected('missing-issue', 'Issue is no longer observed.');
          const result = yield* config.scheduler.start({
            issue: issue.number,
            base: config.base,
            context: command.payload.context,
          });
          return commandResult(result, issue.number);
        }
        const job = input.jobs.find(
          (j) =>
            j.kind === 'job' && `job:rafaeltab/wallpaperdb/${j.intent.issue}` === action.targetId
        );
        if (job?.kind !== 'job')
          return rejected('missing-job', 'Owning job is no longer observed.');
        if (command.kind === 'retry') {
          if (!retryTarget || retryTarget.retry.jobId !== job.intent.id)
            return rejected('stale-retry', 'The displayed failed attempt changed.');
          return commandResult(
            yield* config.scheduler.retry(retryTarget.retry, retryTarget.scheduleRevision),
            job.intent.issue
          );
        }
        if (command.kind === 'resume' && !job.resume)
          return rejected('stale-resume', 'The stage, run or question changed.');
        const result =
          command.kind === 'cancel'
            ? yield* config.scheduler.cancel(job.intent.id)
            : job.resume
              ? yield* config.scheduler.resume({ jobId: job.intent.id, ...job.resume })
              : { kind: 'rejected' as const };
        return commandResult(result, job.intent.issue);
      }),
  };
}
function commandResult(result: import('../capabilities/job/index.js').StartResult, issue: number) {
  if (result.kind === 'rejected' || result.kind === 'occupied')
    return {
      state: 'rejected' as const,
      result: null,
      reasons: [
        {
          code: result.kind,
          message: 'Factory policy rejected this operation. Refresh current state.',
        },
      ],
    };
  if (
    result.kind === 'empty' ||
    result.execution.kind === 'ambiguous' ||
    result.execution.kind === 'absent'
  )
    return {
      state: 'uncertain' as const,
      result: { jobId: `job:rafaeltab/wallpaperdb/${issue}` as const },
      reasons: [
        {
          code: 'uncertain-operation',
          message:
            'The owning operation is retained but execution could not be confirmed. Do not launch again.',
        },
      ],
    };
  return {
    state: 'succeeded' as const,
    result: { jobId: `job:rafaeltab/wallpaperdb/${issue}` as const },
    reasons: [],
  };
}
