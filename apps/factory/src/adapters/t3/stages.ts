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
};
export function receiptInstructions(intent: Intent, stage: StageRequest['stage']) {
  return `On successful completion only, return one JSON object as your entire final message with jobId=${JSON.stringify(intent.id)}, stage=${JSON.stringify(stage)}, base=${JSON.stringify(intent.base)}, commit=full current HEAD, outcome=${JSON.stringify(markers[stage])}, tests=true, coverage=true, crap=true, reviews=${stage === 'implementation' ? 'false' : 'true'}. True values attest completed applicable required checks, configured CRAP and fresh independent Standards/Spec/Defects review at the reported commit. Never claim missing checks. No Markdown fences or other text. Keep detailed evidence in the outside-repository ledger and preserve it for subsequent stages.`;
}
const receiptSchema = z
  .object({
    jobId: z.string(),
    stage: z.enum(['implementation', 'review', 'publication']),
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
  prBase: string
): Pick<Execution, 'inspectStage' | 'sendStage'> {
  return {
    sendStage: (intent, request) =>
      Effect.gen(function* () {
        const binding = yield* observe(intent);
        if (binding.kind !== 'found' || binding.threadId !== request.threadId)
          return yield* Effect.fail(
            new Unavailable({ operation: 'stage-binding-changed', cause: null })
          );
        yield* Effect.tryPromise({
          try: async (signal) => {
            const head = (
              await command('git', ['rev-parse', 'HEAD'], binding.worktree, signal)
            ).trim();
            if (
              head !== request.commit ||
              (await command('git', ['status', '--porcelain'], binding.worktree, signal)).trim()
            )
              throw new Error('Accepted commit changed before stage delivery');
            await call(['send', request.threadId, stagePrompt(intent, request, prBase)], signal);
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
            if (!observed) return pendingRun(raw, request);
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
              linked: thread.pullRequests?.map((pr) => pr.url) ?? [],
            };
          },
          catch: (cause) => new Unavailable({ operation: 'inspect-stage', cause }),
        }).pipe(Effect.tapError((error) => Effect.logError(error)));
      }).pipe(Effect.withSpan('factory.t3.inspect-stage')),
  };
}

function stagePrompt(intent: Intent, request: StageRequest, prBase: string) {
  const skill = request.stage === 'review' ? '$review-loop' : '$publish-pr';
  return `Use ${skill} for ${intent.issueUrl} against PR target ${prBase}, pinned comparison ${intent.base}, in this existing bound checkout. Stage ${request.index} of factory job ${intent.id}; predecessor run ${request.previousRunId}; reviewed starting commit ${request.commit}. Preserve all requirements, decisions, validation and demo handoffs in this thread. Only this issue is authorized. All agents and fresh independent reviewers use gpt-6.1-sol. Publication must reconcile an existing PR before creating one, keep it concise, link it in T3, leave the issue open, and stop before CI repairs or merging. Mutation and hosted approval are advisory. ${receiptInstructions(intent, request.stage)}`;
}
function completed(thread: z.infer<typeof stageDetail>['thread'], request: StageRequest) {
  return (
    thread.threadId === request.threadId &&
    thread.status === 'completed' &&
    thread.pendingRequestCount === 0 &&
    thread.runCount === request.index + 1 &&
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
    (request.stage === 'implementation' || result.reviews)
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

function pendingRun(raw: unknown, request: StageRequest) {
  const detail = stageDetail.safeParse(raw);
  if (!detail.success) return null;
  const { thread } = detail.data;
  if (
    thread.threadId !== request.threadId ||
    thread.runCount !== request.index + 1 ||
    !thread.latestRunId
  )
    return null;
  return {
    runId: thread.latestRunId,
    ordinal: thread.runCount,
    commit: request.commit,
    accepted: false,
  };
}
