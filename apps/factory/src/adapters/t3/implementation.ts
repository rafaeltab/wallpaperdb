import { prepareExecution, observeExecutionSettings } from './execution-settings.js';
import { inactiveLineage } from './inactivity.js';
import { mcpCall, pendingQuestion } from './questions.js';
import { Effect } from 'effect';
import { z } from 'zod';
import {
  type Execution,
  type Intent,
  type Observation,
  type StageRequest,
  Unavailable,
} from '../../capabilities/job/index.js';
import { command } from '../../platform/index.js';
import { receiptInstructions, stageExecution } from './stages.js';
import { ObservationUnknown, type T3Observations } from './observations.js';
const associations = z.object({
  pullRequests: z.array(z.object({ url: z.string().url(), source: z.string() })),
});
const listing = z.array(z.object({ threadId: z.string().min(1), title: z.string() }));
const detail = z.object({
  thread: z.object({
    threadId: z.string().min(1),
    projectId: z.string().min(1),
    title: z.string(),
    providerInstanceId: z.string(),
    model: z.string(),
    branch: z.string().nullable(),
    worktreePath: z.string().nullable(),
    status: z.enum([
      'idle',
      'preparing',
      'queued',
      'starting',
      'running',
      'waiting',
      'completed',
      'interrupted',
      'failed',
      'cancelled',
      'rolled_back',
    ]),
    pendingRequestCount: z.number().int().nonnegative(),
    latestRunId: z.string().nullable(),
    runCount: z.number().int().nonnegative(),
  }),
});
const identity = (intent: Intent) => `[factory:${intent.id}]`;
const title = (intent: Intent) =>
  `Factory #${intent.issue}${intent.issueTitle ? `: ${intent.issueTitle.replace(/\s+/g, ' ').trim().slice(0, 180)}` : ''} ${identity(intent)}`;
const matchesTitle = (value: string, intent: Intent) =>
  value === `Factory ${intent.id}` || value.endsWith(` ${identity(intent)}`);
export function t3Execution(config: {
  binary: string;
  project: string;
  projectId: string;
  prBase?: string;
  mcpEndpoint?: string;
  mcpAuthorizationFile?: string;
  observations?: T3Observations;
}): Execution {
  const call = (args: string[], signal?: AbortSignal): Promise<unknown> => {
    if (config.observations && args[0] === 'list')
      return Promise.resolve(config.observations.list(config.projectId));
    if (config.observations && args[0] === 'show' && args[1])
      return Promise.resolve(config.observations.show(args[1], Number(args[3] ?? 1000)));
    return command(config.binary, ['thread', ...args, '--json'], config.project, signal).then(
      (text) => JSON.parse(text)
    );
  };
  const inactive = (threadId: string, runId: string | null, signal?: AbortSignal) =>
    config.observations
      ? Promise.resolve(config.observations.inactive(threadId, runId))
      : inactiveLineage(
          (tool, args, childSignal) => mcpCall(config, tool, args, childSignal),
          threadId,
          runId,
          signal
        );
  const submit = (launch: (signal?: AbortSignal) => Promise<unknown>) =>
    Effect.tryPromise({
      try: async (signal) => {
        const launched = z
          .object({
            threadId: z.string().min(1),
            projectId: z.literal(config.projectId),
            runId: z.string().nullable(),
          })
          .parse(await launch(signal));
        return { kind: 'submitted' as const, threadId: launched.threadId };
      },
      catch: (cause) => new Unavailable({ operation: 'launch', cause }),
    }).pipe(
      Effect.catch((error) =>
        Effect.logError(error).pipe(Effect.as({ kind: 'uncertain' as const }))
      ),
      Effect.withSpan('factory.t3.launch')
    );
  const prepareLaunch = (intent: Intent) =>
    Effect.tryPromise({
      try: (signal) =>
        prepareExecution(
          config,
          {
            title: title(intent),
            message: `Use $implement for ${intent.issueUrl} in this bound checkout against ${intent.base}. Only this selected issue is authorized. Only rafaeltab and zero-two-rafaeltab may expand scope. Do not implement deferred future work or admit the parent spec. Stop before independent review/publication. Additional maintainer execution context follows and narrows this stage when present:
${intent.context}
Verified prerequisite evidence: ${intent.prerequisiteEvidence ?? 'None'}
${receiptInstructions(intent, 'implementation')}`,
            base: intent.base,
            branch: intent.branch,
          },
          intent.execution,
          signal
        ),
      catch: (cause) => new Unavailable({ operation: 'prepare-launch', cause }),
    }).pipe(Effect.map(submit), Effect.withSpan('factory.t3.prepare-launch'));
  const execution = {
    prepareLaunch,
    launch: (intent: Intent) =>
      prepareLaunch(intent).pipe(
        Effect.flatMap((launch) => launch),
        Effect.catch((error) =>
          Effect.logError(error).pipe(Effect.as({ kind: 'uncertain' as const }))
        )
      ),
    observe: (intent: Intent, repair?: StageRequest) =>
      Effect.tryPromise({
        try: async (signal): Promise<Observation & { failure?: Unavailable }> => {
          config.observations?.retainJob(
            intent.issue,
            intent.id.replace(/:retry-\d+$/, ''),
            repair?.threadId
          );
          const matches = repair
            ? [{ threadId: repair.threadId, title: title(intent) }]
            : listing
                .parse(await call(['list', '--project', config.projectId], signal))
                .filter((item) => matchesTitle(item.title, intent));
          if (matches.length === 0)
            return {
              kind:
                config.observations && !config.observations.inventoryReady()
                  ? 'ambiguous'
                  : 'absent',
            };
          if (matches.length !== 1) return { kind: 'ambiguous' };
          const match = matches[0];
          if (!match) return { kind: 'ambiguous' };
          let observed: unknown;
          try {
            observed = await call(['show', match.threadId, '--messages', '1'], signal);
          } catch (cause) {
            if (cause instanceof ObservationUnknown)
              return repair
                ? { kind: 'unverified', threadId: repair.threadId, status: 'unknown' }
                : { kind: 'ambiguous' };
            throw cause;
          }
          const { thread } = detail.parse(observed);
          if (thread.threadId !== match.threadId || thread.projectId !== config.projectId)
            return { kind: 'ambiguous' };
          const unverified: Observation = repair
            ? {
                kind: 'unverified',
                threadId: repair.threadId,
                status: thread.status,
                run:
                  thread.latestRunId && thread.runCount > 0
                    ? { id: thread.latestRunId, ordinal: thread.runCount }
                    : undefined,
              }
            : { kind: 'ambiguous' };
          const binding = z
            .object({
              projectId: z.literal(config.projectId),
              title: z.string().refine((value) => matchesTitle(value, intent)),
              threadId: z.literal(match.threadId),
              providerInstanceId: z.literal('codex'),
              model: z.literal(intent.execution?.model ?? 'gpt-6.1-sol'),
              branch: z.literal(intent.branch),
              worktreePath: z
                .string()
                .min(1)
                .refine((path) => path !== config.project),
            })
            .safeParse(thread);
          if (!binding.success) return unverified;
          const worktree = binding.data.worktreePath;
          try {
            const branch = (
              await command('git', ['branch', '--show-current'], worktree, signal)
            ).trim();
            await verifyObservedHead(worktree, intent, thread.threadId, repair, signal);
            if (branch !== intent.branch) return unverified;
            const questions = await questionObservation(config, thread, signal, intent.id);
            return {
              ...questions,
              run: questions.run
                ? {
                    ...questions.run,
                    startedAt: questions.runStartedAt
                      ? Date.parse(questions.runStartedAt)
                      : undefined,
                  }
                : undefined,
              kind: 'found',
              threadId: thread.threadId,
              status: thread.pendingRequestCount > 0 ? 'waiting-for-input' : thread.status,
              worktree,
              branch,
              model: thread.model,
              observedExecution: intent.execution
                ? await observeExecutionSettings(config, thread.threadId, signal)
                : undefined,
            };
          } catch (error) {
            // Checkout/receipt verification cannot erase a known worker lifecycle.
            if (repair && !signal.aborted)
              return {
                ...unverified,
                failure: new Unavailable({ operation: 'observe-binding', cause: error }),
              };
            throw error;
          }
        },
        catch: (cause) => new Unavailable({ operation: 'observe', cause }),
      }).pipe(
        Effect.flatMap(({ failure, ...observation }) =>
          failure
            ? Effect.logError(failure).pipe(Effect.as(observation))
            : Effect.succeed(observation)
        ),
        Effect.tapError((error) => Effect.logError(error)),
        Effect.withSpan('factory.t3.observe')
      ),
  };
  return {
    ...execution,
    isIdle: (threadId, runId) =>
      Effect.tryPromise({
        try: async (signal) => (await inactive(threadId, runId, signal)) === 'idle',
        catch: (cause) => new Unavailable({ operation: 'observe-managed-inactivity', cause }),
      }).pipe(
        Effect.tapError((error) => Effect.logError(error)),
        Effect.withSpan('factory.t3.inactivity')
      ),
    release: (intent) =>
      Effect.sync(() => {
        config.observations?.retireIssue(intent.issue);
      }),
    interrupt: (intent, threadId) =>
      Effect.tryPromise({
        try: async (signal) => {
          await mcpCall(
            config,
            't3_thread_interrupt',
            {
              threadId,
              clientRequestId: `${intent.id}:cancel`,
              reason: 'Explicit factory cancellation',
            },
            signal
          );
        },
        catch: (cause) => new Unavailable({ operation: 'interrupt', cause }),
      }).pipe(
        Effect.tapError((error) => Effect.logError(error)),
        Effect.withSpan('factory.t3.interrupt')
      ),
    ...stageExecution(
      call,
      execution.observe,
      config.prBase ?? 'main',
      async (threadId, signal) => {
        const result = associations.parse(
          await mcpCall(config, 'list_thread_pull_requests', { threadId }, signal)
        );
        return result.pullRequests
          .filter((pr) => pr.source !== 'stack-dismissed')
          .map((pr) => pr.url);
      },
      (signal) => command(config.binary, ['thread', 'send', '--help'], config.project, signal),
      inactive,
      config.mcpEndpoint && config.mcpAuthorizationFile
        ? (intent, request, prompt, signal) =>
            mcpCall(
              config,
              't3_thread_send',
              {
                threadId: request.threadId,
                message: prompt,
                mode: 'queue',
                clientRequestId: `${intent.id}:stage:${request.index}`,
              },
              signal
            )
        : undefined
    ),
  };
}

async function questionObservation(
  config: Parameters<typeof t3Execution>[0],
  thread: z.infer<typeof detail>['thread'],
  signal?: AbortSignal,
  jobId?: string
) {
  if (config.observations || (config.mcpEndpoint && config.mcpAuthorizationFile))
    return {
      ...(await pendingQuestion(config, thread.threadId, thread.latestRunId, signal, jobId)),
      run: currentRun(thread),
    };
  if (thread.pendingRequestCount > 0)
    throw new Error('Structured T3 MCP observation requires endpoint and authorization file');
  return { question: undefined, run: currentRun(thread), runStartedAt: undefined };
}
function currentRun(thread: z.infer<typeof detail>['thread']) {
  return thread.latestRunId ? { id: thread.latestRunId, ordinal: thread.runCount } : undefined;
}

function exactReplayHead(head: string, repair?: StageRequest) {
  if (repair?.stage !== 'babysitting' || !repair.comparison) return false;
  return (
    head === repair.comparison.previousHead ||
    Boolean(repair.comparison.owningHeads?.includes(head))
  );
}
function replayObservationBase(intent: Intent, repair?: StageRequest) {
  return repair?.comparison?.base ?? repair?.acceptedBase ?? intent.base;
}

async function verifyObservedHead(
  worktree: string,
  intent: Intent,
  threadId: string,
  repair: StageRequest | undefined,
  signal: AbortSignal
) {
  const bound = repair?.threadId === threadId ? repair : undefined;
  const head = (await command('git', ['rev-parse', 'HEAD'], worktree, signal)).trim();
  if (exactReplayHead(head, bound)) return;
  try {
    await command(
      'git',
      ['merge-base', '--is-ancestor', replayObservationBase(intent, bound), 'HEAD'],
      worktree,
      signal
    );
  } catch (cause) {
    // A changed base does not change thread/worktree ownership. Completion's
    // comparison verifier rejects omitted prerequisites as manual recovery.
    if (cause instanceof Error && 'code' in cause && cause.code === 1) return;
    throw cause;
  }
}
