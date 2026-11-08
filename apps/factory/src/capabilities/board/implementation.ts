import { cursorPayload } from './cursors.js';
import { Effect, Option, Semaphore } from 'effect';
import { Time } from '../job/index.js';
import type { ScheduleSnapshot } from '../observe/index.js';
import type { BoardPlan } from './contract.js';
import { planningIdentity } from './plan-basis.js';
import { AttemptStore, IPlanner } from '../plan/index.js';
import { actions } from './actions.js';
import { retainFacts, retainFact } from './retention.js';
import { entityChanges } from './changes.js';
import { BoardCommands, BoardStore, type CommandRecord } from './contract.js';
import type { Action, BoardChanges, BoardCommand, BoardDelta, BoardFailure } from './model.js';
import { includePlan, planDetails } from './plans.js';
import { project } from './projection.js';
import { issueSearch } from './search.js';
import { failure, version } from './values.js';

const maxOutstandingCommands = 64;

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
    const planner = Option.getOrUndefined(yield* Effect.serviceOption(IPlanner));
    const restored = yield* store.read();
    const epoch = config.epoch;
    let revision = 0,
      input = config.initial;
    const cursor = () =>
      Buffer.from(JSON.stringify({ scope: config.scopeId, epoch, revision })).toString('base64url');
    const at = new Date(yield* time.now()).toISOString();
    const initial = project(input, at, config.scopeId, cursor());
    if (config.initialPlan) {
      const detail = planDetails(
        config.initialPlan,
        initial.snapshot,
        yield* store.planBasis(`plan:${config.initialPlan.id}`),
        planningIdentity(input)
      );
      initial.snapshot = includePlan(initial.snapshot, detail, !!input.observations.facts);
    }
    let current = { ...initial, snapshot: actions(initial.snapshot, input, initial.details) };
    for (const detail of Object.values(current.details)) {
      const item = current.snapshot.entities.items[detail.itemId];
      if (item) current.details[detail.itemId] = { ...detail, itemVersion: item.version };
    }
    let history: readonly BoardDelta[] = restored?.history ?? [];
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
    const uncertainAccepts = new Set<string>();
    const uncertainClaims = new Set<string>();
    yield* store.interruptPending({
      code: 'interrupted-command',
      message:
        'Command processing was interrupted. Reconcile the owning operation before submitting new work.',
    });
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
          const basis = yield* store.planBasis(`plan:${lastPlan.id}`);
          const detail = planDetails(
            lastPlan,
            next.snapshot,
            basis ?? undefined,
            planningIdentity(input)
          );
          next.snapshot = includePlan(next.snapshot, detail, !!input.observations.facts);
        }
        revision++;
        next.snapshot = actions({ ...next.snapshot, cursor: cursor() }, input, next.details);
        for (const detail of Object.values(next.details)) {
          const item = next.snapshot.entities.items[detail.itemId];
          if (item) next.details[detail.itemId] = { ...detail, itemVersion: item.version };
        }
        const delta: BoardDelta = {
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
    const replayCommand = (request: BoardCommand, prior: CommandRecord) => {
      if (
        version(request) === version(prior.request) &&
        prior.receipt.state === 'accepted' &&
        !receipts.has(request.commandId) &&
        receipts.size < maxOutstandingCommands
      )
        receipts.set(request.commandId, prior);
      return replay(request, prior);
    };
    const submit = (request: BoardCommand) =>
      Effect.gen(function* () {
        const prior = yield* store.command(request.commandId);
        if (prior) return replayCommand(request, prior);
        if (receipts.size >= maxOutstandingCommands)
          return failure(
            'command-capacity',
            'The command worker is at its pending limit. Observe outstanding receipts and retry later.',
            request.commandId
          );
        const action = current.snapshot.entities.actions[request.actionId];
        const rejected = validate(request, action);
        if (rejected) return rejected;
        const record: CommandRecord = {
          request,
          planningNotice:
            request.kind === 'acknowledge-planning-failures' && input.planningSafety?.notice
              ? { id: input.planningSafety.notice.id, version: input.planningSafety.notice.version }
              : undefined,
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
        if (
          !(yield* store.accept(record).pipe(
            Effect.tapError(() =>
              Effect.sync(() => {
                receipts.set(request.commandId, record);
                uncertainAccepts.add(request.commandId);
              })
            )
          ))
        ) {
          const winner = yield* store.command(request.commandId);
          return winner
            ? replayCommand(request, winner)
            : failure(
                'ledger-unavailable',
                'Command responsibility unavailable. Observe before retrying.',
                request.commandId
              );
        }
        receipts.set(request.commandId, record);
        return { kind: 'accepted' as const, receipt: record.receipt };
      }).pipe(lock.withPermits(1), Effect.withSpan('factory.board.submit'));
    const processPending = (commandId?: string) =>
      Effect.gen(function* () {
        for (let record of [...receipts.values()].filter(
          (r) => r.receipt.state !== 'running' && (!commandId || r.request.commandId === commandId)
        )) {
          if (uncertainAccepts.has(record.request.commandId)) {
            // An insert can commit and still report failure. Only the exact durable
            // accepted request grants authority to proceed; memory alone never does.
            const retained = yield* store.command(record.request.commandId);
            uncertainAccepts.delete(record.request.commandId);
            if (
              retained?.receipt.state !== 'accepted' ||
              version(retained.request) !== version(record.request)
            ) {
              receipts.delete(record.request.commandId);
              continue;
            }
            record = retained;
            receipts.set(record.request.commandId, retained);
          }
          // A computed outcome may still need persistence. Never execute it again.
          if (record.receipt.state !== 'accepted') {
            yield* store.finish(record);
            receipts.delete(record.request.commandId);
            continue;
          }
          if (uncertainClaims.has(record.request.commandId)) {
            const retained = yield* store.command(record.request.commandId);
            uncertainClaims.delete(record.request.commandId);
            if (retained?.receipt.state === 'running') {
              const uncertain: CommandRecord = {
                ...record,
                receipt: {
                  ...record.receipt,
                  state: 'uncertain',
                  version: '3',
                  reasons: [
                    {
                      code: 'claim-outcome-uncertain',
                      message:
                        'Command ownership could not be confirmed. Reconcile the owning operation before retrying.',
                    },
                  ],
                },
              };
              receipts.set(record.request.commandId, uncertain);
              yield* store.finish(uncertain);
              receipts.delete(record.request.commandId);
              continue;
            }
            if (retained?.receipt.state !== 'accepted') {
              receipts.delete(record.request.commandId);
              continue;
            }
          }
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
            if (
              !(yield* store
                .claim(running)
                .pipe(
                  Effect.tapError(() =>
                    Effect.sync(() => uncertainClaims.add(record.request.commandId))
                  )
                ))
            ) {
              const winner = yield* store.command(record.request.commandId);
              if (winner && winner.receipt.state === 'accepted')
                receipts.set(record.request.commandId, winner);
              else receipts.delete(record.request.commandId);
              continue;
            }
            receipts.set(record.request.commandId, running);
            result = yield* commands
              .execute(record.request, action, input, record.planningNotice)
              .pipe(
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
          receipts.set(record.request.commandId, completed);
          yield* store.finish(completed);
          receipts.delete(record.request.commandId);
        }
      }).pipe(worker.withPermits(1), Effect.withSpan('factory.board.commands'));
    yield* publish(config.initial, config.initialPlan);
    return {
      snapshot: () => current.snapshot,
      publish,
      submit,
      processPending,
      changes: (after: string): BoardChanges | BoardFailure => {
        if (after === current.snapshot.cursor) return { kind: 'unchanged', cursor: after };
        const index = history.findIndex((d) => d.fromCursor === after);
        if (index < 0) {
          const parsed = cursorPayload(after);
          if (!parsed) return failure('invalid-input', 'Invalid change cursor.');
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
      hasPending: () => [...receipts.values()].some((r) => r.receipt.state !== 'running'),
      search: issueSearch(() => current.snapshot),
      details: (id: string) => current.details[id],
      plan: (id: string) =>
        Effect.gen(function* () {
          const attempt =
            current.snapshot.entities.plans[id as import('./model.js').PlanAttempt['id']];
          if (!attempt) {
            const old =
              id.startsWith('plan:') && attempts ? yield* attempts.get(id.slice(5)) : undefined;
            const ownership = old && planner ? yield* planner.ownership(false, old.id) : undefined;
            const basis = old ? yield* store.planBasis(id) : undefined;
            return old
              ? planDetails(
                  { ...old, launch: ownership?.requestId === old.id ? ownership : undefined },
                  current.snapshot,
                  basis,
                  planningIdentity(input)
                )
              : undefined;
          }
          const { issues, repositories, labels, users, sources, threads } =
            current.snapshot.entities;
          return {
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
function replay(request: BoardCommand, prior: CommandRecord) {
  return version(request) === version(prior.request)
    ? {
        kind:
          prior.receipt.state === 'accepted' || prior.receipt.state === 'running'
            ? ('pending' as const)
            : ('completed' as const),
        receipt: prior.receipt,
      }
    : failure(
        'command-id-reused',
        'This command ID is bound to a different request.',
        request.commandId
      );
}
function validate(request: BoardCommand, action: Action | undefined): BoardFailure | undefined {
  if (!action) return failure('action-not-found', 'Unknown action.', request.commandId);
  if (action.kind !== request.kind)
    return failure('invalid-input', 'Command kind does not match its action.', request.commandId);
  if (action.availability.state !== 'available')
    return failure('action-unavailable', 'The action is currently unavailable.', request.commandId);
  if (action.availability.precondition !== request.precondition)
    return failure(
      'action-changed',
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
