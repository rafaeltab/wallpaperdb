import { cursorPayload } from './cursors.js';
import { Effect, Option, Semaphore } from 'effect';
import { Time } from '../job/index.js';
import type { ScheduleSnapshot } from '../observe/index.js';
import type { BoardPlan } from './contract.js';
import { planningIdentity } from './plan-basis.js';
import { AttemptStore } from '../plan/index.js';
import { actions } from './actions.js';
import { retainFacts, retainFact } from './retention.js';
import { entityChanges } from './changes.js';
import { BoardCommands, BoardStore, type CommandRecord } from './contract.js';
import type {
  Action,
  FactoryV2Changes,
  FactoryV2Command,
  FactoryV2Delta,
  FactoryV2Problem,
} from './model.js';
import { planDetails } from './plans.js';
import { project } from './projection.js';
import { issueSearch } from './search.js';
import { problem, version } from './values.js';

/** Pure reads observe one committed revision. Effectful publication and command
 * responsibility use the store before publishing anything to the transport. */
export function makeBoard(config: {
  scopeId: string;
  initial: ScheduleSnapshot;
  epoch: string;
  initialPlan?: BoardPlan;
}) {
  return Effect.gen(function* () {
    const store = yield* BoardStore,
      commands = yield* BoardCommands,
      time = yield* Time;
    const lock = yield* Semaphore.make(1),
      worker = yield* Semaphore.make(1);
    const attempts = Option.getOrUndefined(yield* Effect.serviceOption(AttemptStore));
    const restored = yield* store.read();
    const epoch = config.epoch;
    let revision = 0,
      input = config.initial;
    const cursor = () =>
      Buffer.from(JSON.stringify({ scope: config.scopeId, epoch, revision })).toString('base64url');
    const at = new Date(yield* time.now()).toISOString();
    const initial = project(input, at, config.scopeId, cursor());
    if (config.initialPlan) {
      const detail = planDetails(config.initialPlan, initial.snapshot);
      initial.snapshot = {
        ...initial.snapshot,
        meta: { ...initial.snapshot.meta, currentPlanId: detail.attempt.id },
        entities: {
          ...initial.snapshot.entities,
          issues: detail.entities.issues,
          plans: { [detail.attempt.id]: detail.attempt },
        },
      };
    }
    let current = { ...initial, snapshot: actions(initial.snapshot, input) };
    for (const detail of Object.values(current.details)) {
      const item = current.snapshot.entities.items[detail.itemId];
      if (item) current.details[detail.itemId] = { ...detail, itemVersion: item.version };
    }
    let history: readonly FactoryV2Delta[] = restored?.history ?? [];
    let identity =
      restored?.inputVersion ?? version({ input: stable(input), plan: config.initialPlan });
    if (restored) current = { snapshot: restored.snapshot, details: restored.details };
    else if (!(yield* store.save({ ...current, history, inputVersion: identity }, null))) {
      const winner = yield* store.read();
      if (winner) {
        current = { snapshot: winner.snapshot, details: { ...winner.details } };
        history = winner.history;
        identity = winner.inputVersion;
      }
    }
    const listeners = new Set<() => void>();
    const receipts = new Map<string, CommandRecord>();
    for (const record of yield* store.commands()) {
      if (record.receipt.state === 'accepted' || record.receipt.state === 'running') {
        const interrupted = {
          ...record,
          receipt: {
            ...record.receipt,
            version: version([record.receipt.version, 'restart']),
            state: 'uncertain' as const,
            reasons: [
              {
                code: 'interrupted-command',
                message:
                  'Command processing was interrupted. Reconcile the owning operation before submitting new work.',
              },
            ],
          },
        };
        yield* store.finish(interrupted);
        receipts.set(record.request.commandId, interrupted);
      } else receipts.set(record.request.commandId, record);
    }
    let lastPlan: BoardPlan | undefined = config.initialPlan;
    const publish = (nextInput: ScheduleSnapshot, plan?: BoardPlan) =>
      Effect.gen(function* () {
        lastPlan = plan ?? lastPlan;
        const nextIdentity = version({ input: stable(nextInput), plan: lastPlan });
        input = nextInput;
        if (identity === nextIdentity) return;
        const before = current.snapshot;
        const next = project(
          input,
          new Date(yield* time.now()).toISOString(),
          config.scopeId,
          cursor()
        );
        next.snapshot = retainFacts(before, next.snapshot);
        for (const [id, detail] of Object.entries(next.details))
          next.details[id] = {
            ...detail,
            checkRuns: retainFact(current.details[id]?.checkRuns, detail.checkRuns),
          };
        if (lastPlan) {
          const basis = [...receipts.values()].find(
            (r) =>
              r.receipt.result &&
              'planId' in r.receipt.result &&
              r.receipt.result.planId === `plan:${lastPlan?.id}`
          )?.basis;
          const detail = planDetails(
            lastPlan,
            next.snapshot,
            basis ?? undefined,
            planningIdentity(input)
          );
          next.snapshot = {
            ...next.snapshot,
            meta: { ...next.snapshot.meta, currentPlanId: detail.attempt.id },
            entities: {
              ...next.snapshot.entities,
              issues: detail.entities.issues,
              plans: { [detail.attempt.id]: detail.attempt },
            },
          };
        }
        revision++;
        next.snapshot = actions({ ...next.snapshot, cursor: cursor() }, input);
        for (const detail of Object.values(next.details)) {
          const item = next.snapshot.entities.items[detail.itemId];
          if (item) next.details[detail.itemId] = { ...detail, itemVersion: item.version };
        }
        const delta: FactoryV2Delta = {
          apiVersion: 2,
          scopeId: config.scopeId,
          fromCursor: before.cursor,
          toCursor: next.snapshot.cursor,
          committedAt: next.snapshot.committedAt,
          changes: entityChanges(before.entities, next.snapshot.entities),
          meta: next.snapshot.meta,
        };
        const nextHistory = [...history, delta].slice(-64);
        if (
          !(yield* store.save(
            { ...next, history: nextHistory, inputVersion: nextIdentity },
            before.cursor
          ))
        ) {
          const winner = yield* store.read();
          if (winner) {
            current = { snapshot: winner.snapshot, details: { ...winner.details } };
            history = winner.history;
            identity = winner.inputVersion;
            for (const listener of listeners) listener();
          }
          return;
        }
        current = next;
        identity = nextIdentity;
        history = nextHistory;
        for (const listener of listeners) listener();
      }).pipe(lock.withPermits(1), Effect.withSpan('factory.board.publish'));
    const submit = (request: FactoryV2Command) =>
      Effect.gen(function* () {
        const prior = yield* store.command(request.commandId);
        if (prior) return replay(request, prior);
        const action = current.snapshot.entities.actions[request.actionId];
        const rejected = validate(request, action);
        if (rejected) return rejected;
        const record: CommandRecord = {
          request,
          basis:
            request.kind === 'preview-plan'
              ? {
                  boardCursor: current.snapshot.cursor,
                  inputVersion: planningIdentity(input),
                  controlVersion: current.snapshot.meta.factory.version,
                }
              : undefined,
          receipt: {
            commandId: request.commandId,
            version: '1',
            actionId: request.actionId,
            state: 'accepted',
            acceptedAt: new Date(yield* time.now()).toISOString(),
            completedAt: null,
            reasons: [],
            result: null,
            resultingCursor: null,
          },
        };
        if (!(yield* store.accept(record))) {
          const winner = yield* store.command(request.commandId);
          return winner
            ? replay(request, winner)
            : problem(
                503,
                'unavailable',
                'Command responsibility unavailable. Observe before retrying.',
                request.commandId
              );
        }
        receipts.set(request.commandId, record);
        return { status: 202 as const, receipt: record.receipt };
      }).pipe(lock.withPermits(1), Effect.withSpan('factory.board.submit'));
    const processPending = () =>
      Effect.gen(function* () {
        for (const record of [...receipts.values()].filter((r) => r.receipt.state === 'accepted')) {
          const action = current.snapshot.entities.actions[record.request.actionId];
          const stale = validate(record.request, action);
          let result: Effect.Success<ReturnType<BoardCommands['execute']>>;
          if (stale || !action)
            result = {
              state: 'rejected',
              result: null,
              reasons: [
                { code: 'stale-action', message: 'The accepted action changed before execution.' },
              ],
            };
          else {
            const running = {
              ...record,
              receipt: { ...record.receipt, state: 'running' as const, version: '2' },
            };
            if (!(yield* store.claim(running))) {
              const winner = yield* store.command(record.request.commandId);
              if (winner) receipts.set(record.request.commandId, winner);
              continue;
            }
            receipts.set(record.request.commandId, running);
            result = yield* commands.execute(record.request, action, input).pipe(
              Effect.catchCause((cause) =>
                Effect.logError('V2 command outcome is uncertain', cause).pipe(
                  Effect.as({
                    state: 'uncertain' as const,
                    result: null,
                    reasons: [
                      {
                        code: 'execution-unavailable',
                        message:
                          'Observe the owning operation and reconcile its outcome before retrying.',
                      },
                    ],
                  })
                )
              )
            );
          }
          const completed = {
            ...record,
            receipt: {
              ...record.receipt,
              ...result,
              version: '3',
              completedAt:
                result.state === 'uncertain' ? null : new Date(yield* time.now()).toISOString(),
            },
          };
          yield* store.finish(completed);
          receipts.set(record.request.commandId, completed);
        }
      }).pipe(worker.withPermits(1), Effect.withSpan('factory.board.commands'));
    yield* publish(config.initial, config.initialPlan);
    return {
      snapshot: () => current.snapshot,
      publish,
      submit,
      processPending,
      changes: (after: string): FactoryV2Changes | FactoryV2Problem => {
        if (after === current.snapshot.cursor) return { kind: 'unchanged', cursor: after };
        const index = history.findIndex((d) => d.fromCursor === after);
        if (index < 0) {
          const parsed = cursorPayload(after);
          if (!parsed) return problem(400, 'invalid-request', 'Invalid change cursor.');
          if (parsed.scope !== config.scopeId)
            return { kind: 'resync-required', reason: 'different-scope' };
          const retained = [
            current.snapshot.cursor,
            ...history.flatMap((delta) => [delta.fromCursor, delta.toCursor]),
          ].flatMap((value) => {
            const cursor = cursorPayload(value);
            return cursor?.epoch === parsed.epoch ? [cursor.revision] : [];
          });
          return {
            kind: 'resync-required',
            reason:
              retained.length && parsed.revision <= Math.max(...retained) ? 'expired' : 'reset',
          };
        }
        const batches = history.slice(index, index + 32);
        return {
          kind: 'changes',
          batches,
          nextCursor: batches[batches.length - 1].toCursor,
          hasMore: index + batches.length < history.length,
        };
      },
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      receipt: (id: string) => Effect.map(store.command(id), (record) => record?.receipt),
      hasPending: () => [...receipts.values()].some((r) => r.receipt.state === 'accepted'),
      search: issueSearch(() => current.snapshot),
      details: (id: string) => current.details[id],
      plan: (id: string) =>
        Effect.gen(function* () {
          const attempt =
            current.snapshot.entities.plans[id as import('./model.js').PlanAttempt['id']];
          if (!attempt) {
            const old =
              id.startsWith('plan:') && attempts ? yield* attempts.get(id.slice(5)) : undefined;
            return old
              ? planDetails(old, current.snapshot, undefined, planningIdentity(input))
              : undefined;
          }
          const { issues, repositories, labels, users, sources, threads } =
            current.snapshot.entities;
          return {
            apiVersion: 2 as const,
            attempt,
            entities: { issues, repositories, labels, users, sources, threads },
          };
        }),
      close: () => {
        listeners.clear();
      },
    };
  });
}
export type Board = Effect.Success<ReturnType<typeof makeBoard>>;
function replay(request: FactoryV2Command, prior: CommandRecord) {
  return version(request) === version(prior.request)
    ? {
        status:
          prior.receipt.state === 'accepted' || prior.receipt.state === 'running'
            ? (202 as const)
            : (200 as const),
        receipt: prior.receipt,
      }
    : problem(
        409,
        'id-reused',
        'This command ID is bound to a different request.',
        request.commandId
      );
}
function validate(
  request: FactoryV2Command,
  action: Action | undefined
): FactoryV2Problem | undefined {
  if (!action) return problem(404, 'not-found', 'Unknown action.', request.commandId);
  if (action.kind !== request.kind)
    return problem(
      400,
      'invalid-request',
      'Command kind does not match its action.',
      request.commandId
    );
  if (action.availability.state !== 'available')
    return problem(
      422,
      'command-rejected',
      'The action is currently unavailable.',
      request.commandId
    );
  if (action.availability.precondition !== request.precondition)
    return problem(
      412,
      'stale-action',
      'The action changed. Refresh before retrying.',
      request.commandId
    );
  return undefined;
}
function stable(input: ScheduleSnapshot) {
  return {
    ...input,
    jobs: input.jobs.map((j) => (j.kind === 'job' ? { ...j, elapsedMs: undefined } : j)),
    observations: { ...input.observations, ageMs: undefined, stale: undefined, state: undefined },
    threads: input.threads
      ? { ...input.threads, ageMs: undefined, stale: undefined, state: undefined }
      : undefined,
  };
}
