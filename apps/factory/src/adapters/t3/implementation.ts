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
}): Execution {
  const call = (args: string[], signal?: AbortSignal) =>
    command(config.binary, ['thread', ...args, '--json'], config.project, signal).then((text) =>
      JSON.parse(text)
    );
  const execution = {
    launch: (intent: Intent) =>
      Effect.tryPromise({
        try: async (signal) => {
          z.object({
            threadId: z.string().min(1),
            projectId: z.literal(config.projectId),
            runId: z.string().nullable(),
          }).parse(
            await call(
              [
                'start',
                config.projectId,
                `Use $implement for ${intent.issueUrl} in this bound checkout against ${intent.base}. Only this selected issue is authorized. Only rafaeltab and zero-two-rafaeltab may expand scope. Do not implement deferred future work or admit the parent spec. Stop before independent review/publication. Additional maintainer execution context follows and narrows this stage when present:
${intent.context}
Verified prerequisite evidence: ${intent.prerequisiteEvidence ?? 'None'}
${receiptInstructions(intent, 'implementation')}`,
                '--title',
                title(intent),
                '--provider',
                'codex',
                '--model',
                'gpt-6.1-sol',
                '--worktree',
                intent.base,
                '--branch',
                intent.branch,
              ],
              signal
            )
          );
          return { kind: 'submitted' as const };
        },
        catch: (cause) => new Unavailable({ operation: 'launch', cause }),
      }).pipe(
        Effect.catch((error) =>
          Effect.logError(error).pipe(Effect.as({ kind: 'uncertain' as const }))
        ),
        Effect.withSpan('factory.t3.launch')
      ),
    observe: (intent: Intent, repair?: StageRequest) =>
      Effect.tryPromise({
        try: async (signal): Promise<Observation> => {
          const matches = listing
            .parse(await call(['list', '--project', config.projectId], signal))
            .filter((item) => matchesTitle(item.title, intent));
          if (matches.length === 0) return { kind: 'absent' };
          if (matches.length !== 1) return { kind: 'ambiguous' };
          const match = matches[0];
          if (!match) return { kind: 'ambiguous' };
          const { thread } = detail.parse(
            await call(['show', match.threadId, '--messages', '1'], signal)
          );
          const binding = z
            .object({
              projectId: z.literal(config.projectId),
              title: z.string().refine((value) => matchesTitle(value, intent)),
              threadId: z.literal(match.threadId),
              providerInstanceId: z.literal('codex'),
              model: z.literal('gpt-6.1-sol'),
              branch: z.literal(intent.branch),
              worktreePath: z
                .string()
                .min(1)
                .refine((path) => path !== config.project),
            })
            .safeParse(thread);
          if (!binding.success) return { kind: 'ambiguous' };
          const worktree = binding.data.worktreePath;
          const branch = (
            await command('git', ['branch', '--show-current'], worktree, signal)
          ).trim();
          await verifyObservedHead(worktree, intent, thread.threadId, repair, signal);
          if (branch !== intent.branch) return { kind: 'ambiguous' };
          const questions = await questionObservation(config, thread, signal);
          return {
            ...questions,
            kind: 'found',
            threadId: thread.threadId,
            status: thread.pendingRequestCount > 0 ? 'waiting-for-input' : thread.status,
            worktree,
            branch,
            model: thread.model,
          };
        },
        catch: (cause) => new Unavailable({ operation: 'observe', cause }),
      }).pipe(
        Effect.tapError((error) => Effect.logError(error)),
        Effect.withSpan('factory.t3.observe')
      ),
  };
  return {
    ...execution,
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
      (signal) => command(config.binary, ['thread', 'send', '--help'], config.project, signal),
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
  signal?: AbortSignal
) {
  if (config.mcpEndpoint && config.mcpAuthorizationFile)
    return {
      ...(await pendingQuestion(config, thread.threadId, thread.latestRunId, signal)),
      run: currentRun(thread),
    };
  if (thread.pendingRequestCount > 0)
    throw new Error('Structured T3 MCP observation requires endpoint and authorization file');
  return { question: undefined, run: currentRun(thread) };
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
  return repair?.comparison && repair.stage !== 'implementation' ? repair.commit : intent.base;
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
  await command(
    'git',
    ['merge-base', '--is-ancestor', replayObservationBase(intent, bound), 'HEAD'],
    worktree,
    signal
  );
}
