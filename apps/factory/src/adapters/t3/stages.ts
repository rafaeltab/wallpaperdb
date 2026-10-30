import { Effect } from 'effect';
import { z } from 'zod';
import {
  type Execution,
  type Intent,
  type StageRequest,
  Unavailable,
} from '../../capabilities/job/index.js';
import { command } from '../../platform/index.js';
const markers = {
  implementation: '<TASK>COMPLETE</TASK>',
  review: '<REVIEW>COMPLETE</REVIEW>',
  publication: '<PR>CREATED</PR>',
  babysitting: '<PR>READY</PR>',
  ci: '',
};
export function receiptInstructions(intent: Intent, stage: StageRequest['stage']) {
  return `On successful completion only, return one JSON object as your entire final message with jobId=${JSON.stringify(intent.id)}, stage=${JSON.stringify(stage)}, base=${JSON.stringify(intent.base)}, commit=full current HEAD, outcome=${JSON.stringify(markers[stage])}, tests=true, coverage=true, crap=true, reviews=${stage === 'implementation' ? 'false' : 'true'}. True values attest completed applicable required checks, configured CRAP and fresh independent Standards/Spec/Defects review at the reported commit. Never claim missing checks. No Markdown fences or other text. Keep detailed evidence in the outside-repository ledger and preserve it for subsequent stages.`;
}
const receiptSchema = z
  .object({
    delivery: z.string().optional(),
    jobId: z.string(),
    stage: z.enum(['implementation', 'review', 'publication', 'babysitting']),
    base: z.string(),
    commit: z.string(),
    outcome: z.string(),
    tests: z.literal(true),
    coverage: z.literal(true),
    crap: z.literal(true),
    reviews: z.boolean(),
  })
  .strict();
const stageDetail = z.object({
  thread: z.object({
    threadId: z.string(),
    latestRunId: z.string().nullable(),
    runCount: z.number().int(),
    status: z.string(),
    pendingRequestCount: z.number(),
    pullRequests: z.array(z.object({ url: z.string() })).optional(),
  }),
  messages: z.array(z.object({ role: z.string(), runId: z.string().optional(), text: z.string() })),
});
export function stageExecution(
  call: (args: string[], signal?: AbortSignal) => Promise<unknown>,
  observe: Execution['observe'],
  prBase: string,
  sendHelp: (signal?: AbortSignal) => Promise<string>,
  sendMcp?: (
    intent: Intent,
    request: StageRequest,
    prompt: string,
    signal?: AbortSignal
  ) => Promise<unknown>
): Pick<Execution, 'inspectStage' | 'sendStage'> {
  return {
    sendStage: (intent, request) =>
      Effect.gen(function* () {
        const binding = yield* observe(intent);
        if (!sendBinding(binding, request))
          return yield* Effect.fail(
            new Unavailable({ operation: 'stage-binding-changed', cause: null })
          );
        yield* Effect.tryPromise({
          try: async (signal) => {
            const head = (
              await command('git', ['rev-parse', 'HEAD'], binding.worktree, signal)
            ).trim();
            if (
              !request.resume &&
              (head !== request.commit ||
                (await command('git', ['status', '--porcelain'], binding.worktree, signal)).trim())
            )
              throw new Error('Accepted commit changed before stage delivery');
            if (sendMcp) {
              await sendMcp(intent, request, stagePrompt(intent, request, prBase), signal);
              return;
            }
            const help = await sendHelp(signal);
            const key = help.includes('--client-request-id')
              ? ['--client-request-id', `${intent.id}:stage:${request.index}`]
              : [];
            await call(
              ['send', request.threadId, stagePrompt(intent, request, prBase), ...key],
              signal
            );
          },
          catch: (cause) => new Unavailable({ operation: 'deliver-stage-uncertain', cause }),
        });
      }).pipe(
        Effect.tapError((error) => Effect.logError(error)),
        Effect.withSpan('factory.t3.send-stage')
      ),
    inspectStage: (intent, request) =>
      Effect.gen(function* () {
        const binding = yield* observe(intent);
        if (binding.kind !== 'found' || binding.threadId !== request.threadId) return null;
        return yield* Effect.tryPromise({
          try: async (signal) => {
            const raw = await call(['show', request.threadId, '--messages', '1'], signal);
            const observed = outcome(raw, intent, request);
            if (!observed) {
              const pending = pendingRun(raw, request, intent);
              if (!pending?.waitingForGitHub) return pending;
              const commit = (
                await command('git', ['rev-parse', 'HEAD'], binding.worktree, signal)
              ).trim();
              const dirty = (
                await command('git', ['status', '--porcelain'], binding.worktree, signal)
              ).trim();
              return { ...pending, commit, waitingForGitHub: !dirty };
            }
            const { thread, result } = observed;
            const commit = (
              await command('git', ['rev-parse', 'HEAD'], binding.worktree, signal)
            ).trim();
            if (
              result.commit !== commit ||
              (await command('git', ['status', '--porcelain'], binding.worktree, signal)).trim()
            )
              return null;
            return {
              runId: thread.latestRunId,
              ordinal: thread.runCount,
              commit,
              accepted: true,
              stageIndex: request.index,
              linked: thread.pullRequests?.map((pr) => pr.url) ?? [],
            };
          },
          catch: (cause) => new Unavailable({ operation: 'inspect-stage', cause }),
        }).pipe(Effect.tapError((error) => Effect.logError(error)));
      }).pipe(Effect.withSpan('factory.t3.inspect-stage')),
  };
}

function stagePrompt(intent: Intent, request: StageRequest, prBase: string) {
  const scope = `Only ${intent.issueUrl} is authorized. Preserve retained scope and decisions. Only rafaeltab and zero-two-rafaeltab may expand scope. Retained context: ${intent.context}`;
  if (request.resume && request.stage !== 'babysitting')
    return resumePrompt(intent, request, scope);
  if (request.stage === 'babysitting')
    return `${request.continuation || request.resume ? 'continue. ' : ''}Use $babysit-pr for ${intent.issueUrl} in this existing bound thread/worktree. Stage ${request.index} of factory job ${intent.id}; delivery ${intent.id}:${request.index}; expected run ordinal ${request.ordinal}. Failed applicable CI requires repair; actual code repairs require affected independent Standards/Spec/Defects re-review before readiness. Only the selected issue and retained agreed scope are authorized; significant proposals return to the coordinator. Preserve manual babysitting behavior, use factory policy: mutation and hosted approval advisory, no automerge or issue closure. ${scope}. Keep questions here. While stuck waiting for GitHub return exactly JSON {"delivery":"${intent.id}:${request.index}","jobId":"${intent.id}","stage":"babysitting","base":"${intent.base}","outcome":"WAITING_FOR_GITHUB"} as the entire final message. Never use that outcome for a human question, active repair, or progressing agent work. ${receiptInstructions(intent, request.stage)} For babysitting only, include delivery="${intent.id}:${request.index}" in every success receipt, including watcher wakes. This immutable delivery identity remains the same through watcher wakes; return receipts only for this active stage.`;
  const skill = request.stage === 'review' ? '$review-loop' : '$publish-pr';
  return `Use ${skill} for ${intent.issueUrl} against PR target ${prBase}, pinned comparison ${intent.base}, in this existing bound checkout. Stage ${request.index} of factory job ${intent.id}; expected run ordinal ${request.ordinal ?? request.index + 1}; predecessor run ${request.previousRunId}; reviewed starting commit ${request.commit}. Preserve all requirements, decisions, validation and demo handoffs in this thread. Only this issue is authorized. All agents and fresh independent reviewers use gpt-6.1-sol. Publication must reconcile an existing PR before creating one, keep it concise, link it in T3, leave the issue open, and stop before CI repairs or merging. Mutation and hosted approval are advisory. ${receiptInstructions(intent, request.stage)}`;
}
function completed(thread: z.infer<typeof stageDetail>['thread'], request: StageRequest) {
  return (
    thread.threadId === request.threadId &&
    thread.status === 'completed' &&
    thread.pendingRequestCount === 0 &&
    expectedRun(thread.runCount, request) &&
    Boolean(thread.latestRunId)
  );
}
function parseReceipt(text: string) {
  try {
    const parsed = receiptSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
function matchesReceipt(
  result: z.infer<typeof receiptSchema>,
  intent: Intent,
  request: StageRequest
) {
  return (
    result.jobId === intent.id &&
    result.stage === request.stage &&
    result.base === intent.base &&
    result.outcome === markers[request.stage] &&
    (request.stage === 'implementation' || result.reviews) &&
    (request.stage !== 'babysitting' || result.delivery === deliveryIdentity(intent, request))
  );
}
function outcome(raw: unknown, intent: Intent, request: StageRequest) {
  const detail = stageDetail.safeParse(raw);
  if (!detail.success) return null;
  const { thread, messages } = detail.data;
  if (!completed(thread, request)) return null;
  const result = receiptForRun(messages.at(-1), thread.latestRunId);
  if (!result || !matchesReceipt(result, intent, request)) return null;
  return { thread: { ...thread, latestRunId: thread.latestRunId ?? '' }, result };
}

function receiptForRun(
  message: z.infer<typeof stageDetail>['messages'][number] | undefined,
  runId: string | null
) {
  if (message?.role !== 'assistant' || message.runId !== runId) return null;
  return parseReceipt(message.text);
}

function pendingRun(raw: unknown, request: StageRequest, intent: Intent) {
  const detail = stageDetail.safeParse(raw);
  if (!detail.success) return null;
  const { thread } = detail.data;
  if (
    thread.threadId !== request.threadId ||
    !expectedRun(thread.runCount, request) ||
    !thread.latestRunId
  )
    return null;
  return {
    runId: thread.latestRunId,
    ordinal: thread.runCount,
    commit: request.commit,
    accepted: false,
    waitingForGitHub: waitingReceipt(detail.data, request, intent),
    stageIndex: waitingReceipt(detail.data, request, intent) ? request.index : undefined,
  };
}

function waitingReceipt(
  detail: z.infer<typeof stageDetail>,
  request: StageRequest,
  intent: Intent
) {
  if (request.stage !== 'babysitting' || !completed(detail.thread, request)) return false;
  const message = detail.messages.at(-1);
  if (message?.role !== 'assistant' || message.runId !== detail.thread.latestRunId) return false;
  try {
    return z
      .object({
        delivery: z.literal(deliveryIdentity(intent, request)),
        jobId: z.literal(intent.id),
        stage: z.literal('babysitting'),
        base: z.literal(intent.base),
        outcome: z.literal('WAITING_FOR_GITHUB'),
      })
      .strict()
      .safeParse(JSON.parse(message.text)).success;
  } catch {
    return false;
  }
}

function expectedRun(ordinal: number, request: StageRequest) {
  const initial = request.ordinal ?? request.index + 1;
  return request.stage === 'babysitting' ? ordinal >= initial : ordinal === initial;
}

function sendBinding(
  binding: import('../../capabilities/job/index.js').Observation,
  request: StageRequest
): binding is Extract<import('../../capabilities/job/index.js').Observation, { kind: 'found' }> {
  if (
    binding.kind !== 'found' ||
    binding.threadId !== request.threadId ||
    binding.question ||
    binding.status === 'waiting-for-input'
  )
    return false;
  return !request.resume || currentResume(binding, request);
}

function resumePrompt(intent: Intent, request: StageRequest, scope: string) {
  const skills = {
    implementation: '$implement',
    review: '$review-loop',
    publication: '$publish-pr',
    babysitting: '$babysit-pr',
    ci: '$babysit-pr',
  };
  return `Resume the existing ${request.stage} stage of this issue job in this owning thread/worktree. Do not admit another job, launch a worker, create another worktree or expand scope. Stage ${request.index} of factory job ${intent.id}; expected run ordinal ${request.ordinal}; predecessor run ${request.previousRunId}. ${scope}. Keep the existing stage handoffs and watchdog association. Use ${skills[request.stage]}. ${receiptInstructions(intent, request.stage)}`;
}

function currentResume(
  binding: Extract<import('../../capabilities/job/index.js').Observation, { kind: 'found' }>,
  request: StageRequest
) {
  return (
    binding.run?.id === request.previousRunId &&
    ['completed', 'interrupted', 'failed', 'cancelled'].includes(binding.status)
  );
}

function deliveryIdentity(intent: Intent, request: StageRequest) {
  return `${intent.id}:${request.deliveryIndex ?? request.index}`;
}
