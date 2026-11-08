import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { plannerMessage } from './planner-message.js';
import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { Effect } from 'effect';
import { z } from 'zod';
import {
  planningInputIdentity,
  type IPlanner,
  type AutomaticDeadlineFailure,
} from '../../capabilities/plan/index.js';
import { Unavailable } from '../../capabilities/job/index.js';
import { plannerState } from './planner-state.js';
import { command } from '../../platform/index.js';
import { mcpCall } from './questions.js';
class ModelDeadline extends Error {}
const numbers = z.array(z.number().int().positive().safe()).max(1000);
const reason = z.string().min(1).max(16000);
const proposalSchema = z
  .object({
    requestId: z.string(),
    selected: z
      .array(
        z
          .object({
            issue: z.number().int().positive().safe(),
            reason,
            dependsOn: numbers,
            conflicts: numbers,
          })
          .strict()
      )
      .max(1000),
    deferred: z
      .array(z.object({ issue: z.number().int().positive().safe(), reason }).strict())
      .max(1000),
  })
  .strict();
export function t3Planner(config: {
  binary: string;
  project: string;
  projectId: string;
  stateDirectory: string;
  mcpEndpoint?: string;
  mcpAuthorizationFile?: string;
  automaticPolicy?: {
    mayLaunch(): Promise<boolean>;
    failed(failure: AutomaticDeadlineFailure): Promise<void>;
  };
}): IPlanner & { reconcile(): Effect.Effect<void, Unavailable> } {
  const call = async (args: string[], signal: AbortSignal, input?: string) =>
    JSON.parse(
      await command(
        config.binary,
        ['thread', ...args, '--json'],
        config.project,
        signal,
        undefined,
        input
      )
    );
  const journal = plannerState(config.stateDirectory);
  let busy = false;
  let reconciling = false;
  let reconciliation = Promise.resolve();
  const startReconciliation = () => {
    reconciling = true;
    let complete: (() => void) | undefined;
    reconciliation = new Promise<void>((resolve) => {
      complete = resolve;
    });
    return () => {
      reconciling = false;
      complete?.();
    };
  };
  const waitForReconciliation = async (signal: AbortSignal) => {
    if (!reconciling) return;
    await new Promise<void>((resolve, reject) => {
      const abort = () => {
        signal.removeEventListener('abort', abort);
        reject(signal.reason);
      };
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
      void reconciliation.then(() => {
        signal.removeEventListener('abort', abort);
        resolve();
      });
    });
    signal.throwIfAborted();
  };
  let needsRecovery = true;
  const terminal = (status: string) =>
    ['idle', 'completed', 'interrupted', 'failed', 'cancelled'].includes(status);
  const observe = async (run: { threadId: string; runId: string }, signal: AbortSignal) =>
    z
      .object({
        thread: z.object({
          threadId: z.literal(run.threadId),
          latestRunId: z.literal(run.runId),
          status: z.string(),
          settled: z.boolean().optional(),
          providerInstanceId: z.literal('codex'),
          model: z.literal('gpt-6.1-sol'),
        }),
        messages: z.array(
          z.object({ role: z.string(), runId: z.string().optional(), text: z.string() })
        ),
      })
      .parse(await call(['show', run.threadId, '--messages', '20'], signal));
  type Record = Awaited<ReturnType<typeof journal.save>>;
  const reportDeadline = async (record: Record) => {
    if (
      !record.automatic ||
      !config.automaticPolicy ||
      record.attemptStartedAt === undefined ||
      record.modelHandedOffAt === undefined ||
      record.deadline === undefined
    )
      return;
    const failedAt = Date.now();
    await config.automaticPolicy.failed({
      attemptId: record.requestId,
      code: 'model-deadline',
      message: 'Automatic planning did not complete within its model deadline.',
      attemptStartedAt: record.attemptStartedAt,
      modelHandedOffAt: record.modelHandedOffAt,
      deadline: record.deadline,
      failedAt,
      attemptElapsedMs: failedAt - record.attemptStartedAt,
      modelElapsedMs: failedAt - record.modelHandedOffAt,
      threadId: record.run?.threadId ?? null,
      runId: record.run?.runId ?? null,
    });
  };
  const ownershipOf = (record: Record) => {
    const { input: _input, inputIdentity: _identity, ...ownership } = record;
    return ownership;
  };
  const interrupt = (run: { threadId: string; runId: string }, signal: AbortSignal) =>
    mcpCall(
      config,
      't3_thread_interrupt',
      { threadId: run.threadId, runId: run.runId, reason: 'Factory model deadline exceeded' },
      signal
    );
  const observeOwned = async (record: Record, signal: AbortSignal) => {
    if (!record.run || record.deadline === undefined)
      throw new Error('Missing durable model ownership');
    const run = record.run;
    // Confirmed completion and settlement have their own provider budgets.
    if (record.phase === 'succeeded' || record.phase === 'failed') return observe(run, signal);
    const remaining = record.deadline - Date.now();
    if (remaining > 0) {
      const deadline = AbortSignal.timeout(remaining);
      try {
        const detail = await observe(run, AbortSignal.any([signal, deadline]));
        if (terminal(detail.thread.status) || Date.now() < record.deadline) return detail;
      } catch (cause) {
        if (signal.aborted || !deadline.aborted) throw cause;
      }
    }
    // Request interruption before another potentially slow observation. An acknowledgement
    // alone never releases ownership, and a lost response still permits terminal evidence.
    let interruptionFailure: unknown;
    try {
      await interrupt(run, signal);
    } catch (cause) {
      interruptionFailure = cause;
    }
    const detail = await observe(run, signal);
    if (['completed', 'idle'].includes(detail.thread.status)) return detail;
    await reportDeadline(record);
    if (terminal(detail.thread.status)) return detail;
    throw new ModelDeadline(
      interruptionFailure
        ? 'Model deadline exceeded; interruption is unconfirmed'
        : 'Model deadline exceeded',
      { cause: interruptionFailure }
    );
  };
  const finish = async (
    record: Awaited<ReturnType<typeof journal.save>>,
    detail: Awaited<ReturnType<typeof observe>>,
    signal: AbortSignal,
    consume = true
  ) => {
    if (record.retired && record.settled) return record;
    const successful = ['completed', 'idle'].includes(detail.thread.status);
    const now = Date.now();
    let completedAt = record.completedAt;
    if (successful && completedAt === undefined && record.deadline !== undefined) {
      if (now < record.deadline) completedAt = now;
      else {
        // Observation/cleanup latency is not model execution time. Use exact run evidence.
        const evidence = z
          .object({
            thread: z.object({
              threadId: z.literal(detail.thread.threadId),
              latestRunId: z.literal(detail.thread.latestRunId),
            }),
            recentRuns: z.array(
              z.object({ runId: z.string(), completedAt: z.string().datetime().nullable() })
            ),
          })
          .parse(
            await mcpCall(
              config,
              't3_thread_read',
              { threadId: detail.thread.threadId, runLimit: 1, limit: 1, maxCharsPerItem: 1 },
              signal
            )
          );
        const finished = evidence.recentRuns.find(
          (run) => run.runId === detail.thread.latestRunId
        )?.completedAt;
        if (finished) {
          const at = Date.parse(finished);
          if (at >= record.deadline - 600000 && at <= record.deadline) completedAt = at;
        }
      }
    }
    if (successful && completedAt === undefined) await reportDeadline(record);
    const phase = successful ? 'succeeded' : 'failed';
    const completed =
      record.phase === phase && record.completedAt === completedAt && record.retired === false
        ? record
        : await journal.save({
            ...record,
            revision: record.revision + 1,
            retired: false,
            phase,
            completedAt,
          });
    // Cleanup failure retains this exact completed run, rather than launching a replacement.
    if (!detail.thread.settled) {
      await mcpCall(
        config,
        't3_thread_organize',
        { action: 'settle', threadId: detail.thread.threadId },
        signal
      );
      const settled = await observe(
        { threadId: detail.thread.threadId, runId: detail.thread.latestRunId },
        signal
      );
      if (!settled.thread.settled) throw new Error('Planner thread settlement is not confirmed');
    }
    // Background cleanup does not consume an undelivered timely proposal. The next
    // matching foreground request must still recover it for fresh validation.
    const retired = record.retired === true || consume || !successful || completedAt === undefined;
    const result =
      completed.retired === retired && completed.settled
        ? completed
        : await journal.save({
            ...completed,
            revision: completed.revision + 1,
            retired,
            settled: true,
          });
    needsRecovery = false;
    return result;
  };
  const recover = async (
    input: Parameters<IPlanner['propose']>[0],
    signal: AbortSignal,
    requestId?: string
  ) => {
    const previous = await journal.read();
    if (previous && requestId === previous.requestId && previous.run) {
      if (
        (previous.inputIdentity ?? previous.input) !==
        (previous.inputIdentity ? planningInputIdentity(input) : JSON.stringify(input))
      )
        throw new Error(
          'Original planner inputs changed; request a fresh preview after reconciliation'
        );
      return await poll(previous, previous.run, signal);
    }
    if (previous && !previous.retired) {
      if (!previous.run)
        throw new Error('Planner launch is uncertain; operator reconciliation required');
      const detail = await observeOwned(previous, signal);
      if (!terminal(detail.thread.status))
        throw new Error('Previous advisory planner is still outstanding');
      const completed = await finish(previous, detail, signal);
      if (
        (previous.inputIdentity ?? previous.input) ===
          (previous.inputIdentity ? planningInputIdentity(input) : JSON.stringify(input)) &&
        completed.completedAt !== undefined &&
        ['completed', 'idle'].includes(detail.thread.status)
      )
        return translateProposal(detail.messages, previous.run.runId, previous.requestId);
    }
    return undefined;
  };
  const poll = async (
    bound: Awaited<ReturnType<typeof journal.save>>,
    run: { threadId: string; runId: string },
    signal: AbortSignal
  ) => {
    if (bound.deadline === undefined) throw new Error('Missing durable model deadline');
    for (;;) {
      const detail = await observeOwned(bound, signal);
      if (terminal(detail.thread.status)) {
        const completed = await finish(bound, detail, signal);
        if (['completed', 'idle'].includes(detail.thread.status)) {
          if (completed.completedAt === undefined)
            throw new ModelDeadline('Model deadline exceeded');
          return translateProposal(detail.messages, run.runId, bound.requestId);
        }
        throw new Error('Planner did not complete');
      }
      if (!['preparing', 'queued', 'starting', 'running'].includes(detail.thread.status))
        throw new Error('Planner did not complete');
      await setTimeout(Math.max(1, Math.min(1000, bound.deadline - Date.now())), undefined, {
        signal,
      });
    }
  };
  return {
    reconcile: () =>
      Effect.tryPromise({
        try: async (signal) => {
          if (busy || reconciling || !needsRecovery) return;
          const finishReconciliation = startReconciliation();
          try {
            const previous = await journal.read();
            if (!previous || previous.settled || !previous.run) {
              needsRecovery = false;
              return;
            }
            const detail = await observeOwned(previous, signal);
            if (terminal(detail.thread.status)) await finish(previous, detail, signal, false);
          } finally {
            finishReconciliation();
          }
        },
        catch: (cause) => new Unavailable({ operation: 'planner-recovery', cause }),
      }).pipe(
        Effect.tapError((error) => Effect.logError(error)),
        Effect.withSpan('factory.t3.planner.recovery')
      ),
    ownership: (reconcile = true, requestId) =>
      Effect.tryPromise({
        try: async (signal) => {
          const previous = await journal.read(requestId);
          if (!previous) return { ownership: undefined };
          let failure: Unavailable | undefined;
          if (
            reconcile &&
            !requestId &&
            previous.run &&
            (!previous.settled || !previous.retired) &&
            !busy &&
            !reconciling
          ) {
            const finishReconciliation = startReconciliation();
            try {
              const detail = await observeOwned(previous, signal);
              if (terminal(detail.thread.status)) {
                const next = await finish(previous, detail, signal);
                return { ownership: ownershipOf(next) };
              }
            } catch (cause) {
              if (!(cause instanceof ModelDeadline)) throw cause;
              failure = new Unavailable({ operation: 'model-deadline', cause });
            } finally {
              finishReconciliation();
            }
          }
          return { ownership: ownershipOf(previous), failure };
        },
        catch: (cause) => new Unavailable({ operation: 'planner-observation', cause }),
      }).pipe(
        Effect.tap((result) => (result.failure ? Effect.logError(result.failure) : Effect.void)),
        Effect.map((result) => result.ownership),
        Effect.tapError((error) => Effect.logError(error)),
        Effect.withSpan('factory.t3.planner.ownership')
      ),
    propose: (input, attempt) =>
      Effect.tryPromise({
        try: async (signal) => {
          if (busy) throw new Error('Planner request already in progress');
          busy = true;
          try {
            await waitForReconciliation(signal);
            const recovered = await recover(input, signal, attempt?.requestId);
            if (recovered) return recovered;
            if (
              attempt?.automatic &&
              config.automaticPolicy &&
              !(await config.automaticPolicy.mayLaunch())
            )
              return { kind: 'paused' as const };
            const requestId = attempt?.requestId ?? randomUUID();
            const current = await journal.read();
            if (current && !current.retired) throw new Error('Planner state changed concurrently');
            const prompt = plannerMessage(input, requestId);
            await mkdir(config.stateDirectory, { recursive: true });
            await writeFile(
              join(config.stateDirectory, `planner-message-${encodeURIComponent(requestId)}.txt`),
              prompt,
              { mode: 0o600 }
            );
            if (prompt.length > 120000) {
              await journal.save({
                revision: (current?.revision ?? -1) + 1,
                requestId,
                input: JSON.stringify(input),
                inputIdentity: planningInputIdentity(input),
                retired: true,
                phase: 'failed',
                detail: `Planner message has ${prompt.length} characters; T3 maximum is 120000. No launch claimed.`,
              });
              throw new Error('Planner message exceeds T3 maximum 120000 characters');
            }
            const handedOffAt = Date.now();
            const intent = await journal.save({
              revision: (current?.revision ?? -1) + 1,
              requestId,
              input: JSON.stringify(input),
              inputIdentity: planningInputIdentity(input),
              automatic: attempt?.automatic,
              attemptStartedAt: attempt?.attemptStartedAt ?? handedOffAt,
              modelHandedOffAt: handedOffAt,
              deadline: Math.min(attempt?.deadline ?? Infinity, handedOffAt + 600000),
              phase: 'launch-intent',
            });
            needsRecovery = true;
            let launched: { threadId: string; projectId: string; runId: string };
            try {
              launched = z
                .object({
                  threadId: z.string().min(1),
                  projectId: z.literal(config.projectId),
                  runId: z.string().min(1),
                })
                .parse(
                  await call(
                    [
                      'start',
                      config.projectId,
                      '-',
                      '--title',
                      `Factory ${attempt?.automatic ? 'automatic plan' : 'plan preview'} ${requestId}`,
                      '--provider',
                      'codex',
                      '--model',
                      'gpt-6.1-sol',
                    ],
                    signal,
                    prompt
                  )
                );
            } catch (cause) {
              // Only a structured explicit invalid-params response proves non-launch.
              const rejected = confirmedRejection(cause);
              await journal.save({
                ...intent,
                revision: intent.revision + 1,
                retired: rejected,
                phase: rejected ? 'failed' : 'uncertain',
                detail: rejected
                  ? 'T3 rejected launch with -32602. No worker started.'
                  : 'Launch response unavailable. Operator reconciliation required.',
              });
              throw cause;
            }
            const bound = await journal.save({
              ...intent,
              revision: intent.revision + 1,
              run: launched,
              phase: 'running',
            });
            return await poll(bound, launched, signal);
          } finally {
            busy = false;
          }
        },
        catch: (cause) =>
          new Unavailable({
            operation: cause instanceof ModelDeadline ? 'model-deadline' : 'planner-proposal',
            cause,
          }),
      }).pipe(
        Effect.tapError((error) => Effect.logError(error)),
        Effect.withSpan('factory.t3.plan')
      ),
  };
}

function translateProposal(
  messages: readonly { role: string; runId?: string; text: string }[],
  runId: string,
  requestId: string
) {
  const final = messages.filter((m) => m.role === 'assistant' && m.runId === runId).at(-1);
  const proposal = proposalSchema.parse(JSON.parse(final?.text ?? 'null'));
  if (proposal.requestId !== requestId) throw new Error('Planner request mismatch');
  return { selected: proposal.selected, deferred: proposal.deferred };
}

function confirmedRejection(cause: unknown): boolean {
  const result = z.object({ stderr: z.string() }).safeParse(cause);
  if (!result.success) return false;
  try {
    const response = JSON.parse(result.data.stderr.trim());
    return z.object({ code: z.literal(-32602), message: z.string() }).safeParse(response).success;
  } catch {
    return false;
  }
}
