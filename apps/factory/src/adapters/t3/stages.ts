import { Effect } from 'effect';
import { z } from 'zod';
import {
  type Execution,
  type Intent,
  type StageRequest,
  stageDeliveryIndex,
  Unavailable,
} from '../../capabilities/job/index.js';
import { command } from '../../platform/index.js';

const historyWindow = 1000;
const markers = {
  implementation: '<TASK>COMPLETE</TASK>',
  review: '<REVIEW>COMPLETE</REVIEW>',
  publication: '<PR>CREATED</PR>',
  babysitting: '<PR>READY</PR>',
  ci: '',
};
export function receiptInstructions(
  intent: Intent,
  stage: StageRequest['stage'],
  delivery = `${intent.id}:0`
) {
  return `On successful completion only, return one JSON object as your entire final message with delivery=${JSON.stringify(delivery)}, jobId=${JSON.stringify(intent.id)}, stage=${JSON.stringify(stage)}, base=${JSON.stringify(intent.base)}, commit=full current HEAD, outcome=${JSON.stringify(markers[stage])}, tests=true, coverage=true, crap=true, reviews=${stage === 'implementation' ? 'false' : 'true'}. True values attest completed applicable required checks, configured CRAP and fresh independent Standards/Spec/Defects review at the reported commit. Never claim missing checks. No Markdown fences or other text. Keep detailed evidence in the outside-repository ledger and preserve it for subsequent stages.`;
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
    sendStage: (original, request) =>
      Effect.gen(function* () {
        const intent = comparisonIntent(original, request);
        const binding = yield* observe(original, request);
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
              (!request.resume || request.stage === 'publication') &&
              (!deliveryHead(head, request) ||
                (await command('git', ['status', '--porcelain'], binding.worktree, signal)).trim())
            )
              throw new Error('Accepted commit changed before stage delivery');
            if (sendMcp) {
              await sendMcp(
                intent,
                request,
                stagePrompt(intent, request, publicationBase(intent, prBase)),
                signal
              );
              return;
            }
            const help = await sendHelp(signal);
            const key = help.includes('--client-request-id')
              ? ['--client-request-id', `${intent.id}:stage:${request.index}`]
              : [];
            await call(
              [
                'send',
                request.threadId,
                stagePrompt(intent, request, publicationBase(intent, prBase)),
                ...key,
              ],
              signal
            );
          },
          catch: (cause) => new Unavailable({ operation: 'deliver-stage-uncertain', cause }),
        });
      }).pipe(
        Effect.tapError((error) => Effect.logError(error)),
        Effect.withSpan('factory.t3.send-stage')
      ),
    inspectStage: (original, request) =>
      Effect.gen(function* () {
        const intent = comparisonIntent(original, request);
        const binding = yield* observe(intent, request);
        if (binding.kind !== 'found' || binding.threadId !== request.threadId) return null;
        return yield* Effect.tryPromise({
          try: async (signal) => {
            const raw = await call(
              ['show', request.threadId, '--messages', String(historyWindow)],
              signal
            );
            const observed = outcome(raw, intent, request);
            if (!observed) {
              const pending = pendingRun(raw, request, intent);
              return pendingWorktree(pending, request, binding, signal);
            }
            const { thread, result } = observed;
            const commit = (
              await command('git', ['rev-parse', 'HEAD'], binding.worktree, signal)
            ).trim();
            const dirty = (
              await command('git', ['status', '--porcelain'], binding.worktree, signal)
            ).trim();
            if (result.commit !== commit || dirty) {
              if (request.stage !== 'implementation') return null;
              // Rejecting success must not erase the exact owning run's evidence.
              const pending = pendingRun(raw, request, intent);
              return pending ? { ...pending, commit, worktreeClean: !dirty } : null;
            }
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

function comparisonIntent(intent: Intent, request: StageRequest): Intent {
  return request.comparison
    ? { ...intent, base: request.comparison.base, prBase: request.comparison.prBase }
    : intent;
}
function stagePrompt(intent: Intent, request: StageRequest, prBase: string) {
  const scope = `Only ${intent.issueUrl} is authorized. Preserve retained scope and decisions. Only rafaeltab and zero-two-rafaeltab may expand scope. Retained context: ${intent.context}`;
  if (request.resume && request.stage !== 'babysitting')
    return resumePrompt(intent, request, scope);
  if (request.stage === 'babysitting')
    return `${request.continuation || request.resume ? 'continue. ' : ''}Use $babysit-pr for ${intent.issueUrl} in this existing bound thread/worktree. Stage ${request.index} of factory job ${intent.id}; delivery ${deliveryIdentity(intent, request)}. Failed applicable CI requires repair; actual code repairs require affected independent Standards/Spec/Defects re-review before readiness. Only the selected issue and retained agreed scope are authorized; significant proposals return to the coordinator. Preserve manual babysitting behavior, use factory policy: mutation and hosted approval advisory, no automerge or issue closure. ${scope}. ${replayInstructions(request)} Reconcile current GitHub CI and any existing watcher before acting. If CI is already successful, verify and return the required receipt without starting another watcher, retrying CI or editing code. Keep questions here. While stuck waiting for GitHub return exactly JSON {"delivery":"${deliveryIdentity(intent, request)}","jobId":"${intent.id}","stage":"babysitting","base":"${intent.base}","outcome":"WAITING_FOR_GITHUB"} as the entire final message. Never use that outcome for a human question, active repair, or progressing agent work. ${receiptInstructions(intent, request.stage, deliveryIdentity(intent, request))} For babysitting only, include delivery="${deliveryIdentity(intent, request)}" in every success receipt, including watcher wakes. This immutable delivery identity remains the same through watcher wakes; return receipts only for this active stage.`;
  const skill = request.stage === 'review' ? '$review-loop' : '$publish-pr';
  return `Use ${skill} for ${intent.issueUrl} against PR target ${prBase}, pinned comparison ${intent.base}, in this existing bound checkout. Stage ${request.index} of factory job ${intent.id}; delivery ${deliveryIdentity(intent, request)}; accepted predecessor commit ${request.commit}; reviewed starting commit ${request.commit}. Preserve all requirements, decisions, validation and demo handoffs in this thread. Only this issue is authorized. All agents and fresh independent reviewers use gpt-6.1-sol. Publication must reconcile an existing PR before creating one, keep it concise, link it in T3, leave the issue open, and stop before CI repairs or merging. Mutation and hosted approval are advisory. ${receiptInstructions(intent, request.stage, deliveryIdentity(intent, request))}`;
}
function completed(thread: z.infer<typeof stageDetail>['thread'], request: StageRequest) {
  return (
    thread.threadId === request.threadId &&
    thread.status === 'completed' &&
    thread.pendingRequestCount === 0 &&
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
    (result.delivery === undefined || result.delivery === deliveryIdentity(intent, request))
  );
}
function outcome(raw: unknown, intent: Intent, request: StageRequest) {
  const detail = stageDetail.safeParse(raw);
  if (!detail.success) return null;
  const { thread, messages } = detail.data;
  if (!completed(thread, request)) return null;
  const result = receiptFromMessage(messages.filter((m) => m.role !== 'system').at(-1));
  if (!result || !matchesReceipt(result, intent, request)) return null;
  if (!deliveryMatches(result, detail.data, intent, request)) return null;
  return { thread: { ...thread, latestRunId: thread.latestRunId ?? '' }, result };
}

function receiptFromMessage(message: z.infer<typeof stageDetail>['messages'][number] | undefined) {
  if (message?.role !== 'assistant') return null;
  return parseReceipt(message.text);
}

function pendingRun(raw: unknown, request: StageRequest, intent: Intent) {
  const detail = stageDetail.safeParse(raw);
  if (!detail.success) return null;
  const { thread } = detail.data;
  const waitingForGitHub = waitingReceipt(detail.data, request, intent);
  if (
    thread.threadId !== request.threadId ||
    !thread.latestRunId ||
    (thread.latestRunId === request.previousRunId && !waitingForGitHub)
  )
    return null;
  return {
    runId: thread.latestRunId,
    ordinal: thread.runCount,
    commit: request.commit,
    accepted: false,
    waitingForGitHub,
    stageIndex: request.index,
  };
}

function waitingReceipt(
  detail: z.infer<typeof stageDetail>,
  request: StageRequest,
  intent: Intent
) {
  if (request.stage !== 'babysitting' || !completed(detail.thread, request)) return false;
  const message = detail.messages.filter((m) => m.role !== 'system').at(-1);
  if (message?.role !== 'assistant') return false;
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

/** Old deliveries did not request a delivery field. Only the last factory instruction
 * in the retained transcript can associate such a receipt. Truncated/ambiguous history
 * stays pending; compatibility never resends completed work or weakens new deliveries. */
function deliveryMatches(
  result: z.infer<typeof receiptSchema>,
  detail: z.infer<typeof stageDetail>,
  intent: Intent,
  request: StageRequest
) {
  if (result.delivery !== undefined) return result.delivery === deliveryIdentity(intent, request);
  if (request.receiptProtocol || request.stage === 'babysitting') return false;
  // The CLI returns a latest-message window with no completeness flag. A full
  // window may hide an identical claim from an earlier delivery.
  if (detail.messages.length >= historyWindow) return false;
  const instructions = detail.messages.filter(
    (m) =>
      m.role === 'user' &&
      (/Stage \d+ of factory job /.test(m.text) || m.text.startsWith('Use $implement for '))
  );
  const instruction = instructions.at(-1);
  if (!instruction) return false;
  const last = instruction.text;
  if (last.includes('with delivery=')) return false;
  // Identical legacy claims from another delivery cannot be disambiguated safely.
  // Repeated receipts after this instruction still belong to the same delivery.
  const boundary = detail.messages.lastIndexOf(instruction);
  if (
    detail.messages.slice(0, boundary).some((message) => {
      const prior = receiptFromMessage(message);
      return (
        prior?.jobId === result.jobId &&
        prior.stage === result.stage &&
        prior.base === result.base &&
        prior.commit === result.commit &&
        prior.outcome === result.outcome
      );
    })
  )
    return false;
  const index = stageDeliveryIndex(request);
  if (index === 0 && request.stage === 'implementation')
    return last.startsWith(
      `Use $implement for ${intent.issueUrl} in this bound checkout against ${intent.base}.`
    );
  const skill =
    request.stage === 'review'
      ? '$review-loop'
      : request.stage === 'implementation'
        ? '$implement'
        : '$publish-pr';
  const original =
    last.startsWith(`Use ${skill} for `) && last.includes(`pinned comparison ${intent.base},`);
  const resumed =
    last.startsWith(`Resume the existing ${request.stage} stage of this issue job`) &&
    last.includes(`Use ${skill}.`) &&
    last.includes(`base=${JSON.stringify(intent.base)},`);
  return (
    last.includes(`Stage ${index} of factory job ${intent.id};`) &&
    last.includes(intent.issueUrl) &&
    (original || resumed)
  );
}

function sendBinding(
  binding: import('../../capabilities/job/index.js').Observation,
  request: StageRequest
): binding is Extract<import('../../capabilities/job/index.js').Observation, { kind: 'found' }> {
  if (
    binding.kind !== 'found' ||
    binding.threadId !== request.threadId ||
    (request.comparison &&
      !['completed', 'idle', 'failed', 'interrupted'].includes(binding.status)) ||
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
  return `Resume the existing ${request.stage} stage of this issue job in this owning thread/worktree. Do not admit another job, launch a worker, create another worktree or expand scope. Stage ${request.index} of factory job ${intent.id}; delivery ${deliveryIdentity(intent, request)}; predecessor run ${request.previousRunId}. ${scope}. Keep the existing stage handoffs and watchdog association. Reconcile actual external outcomes before any side effect. For publication, inspect and reuse the existing PR and publication journal before considering creation; never create a duplicate or republish an already matching head. For already successful CI, verify the existing outcome and return the required receipt without starting another watcher or retrying CI. Use ${skills[request.stage]}. ${receiptInstructions(intent, request.stage, deliveryIdentity(intent, request))}`;
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
  return `${intent.id}:${stageDeliveryIndex(request)}`;
}

function publicationBase(intent: Intent, fallback: string) {
  return intent.prBase ?? fallback;
}

function deliveryHead(head: string, request: StageRequest) {
  return (
    head === request.commit ||
    (request.stage === 'babysitting' && knownOwningHead(head, request.comparison))
  );
}
function replayInstructions(request: StageRequest) {
  if (!request.comparison) return '';
  return `Owned replay CI repair at ${request.commit}, actual comparison ${request.comparison.base}, PR target ${request.comparison.prBase}. Before editing reconcile this clean owning worktree from the prior accepted head ${request.comparison.previousHead} to exactly the already-published replay head ${request.commit}, with expected-head checks and affected-writer coordination. Earlier exact owning associations ${JSON.stringify(request.comparison.owningHeads ?? [])} are also eligible starting heads; do not treat arbitrary ancestors as authorized. Preserve every published tip and original review provenance. Do not replay landed prerequisites. Return no success until actual repairs are independently reviewed and current-tree CI passes.`;
}

function knownOwningHead(head: string, comparison: StageRequest['comparison']) {
  return head === comparison?.previousHead || Boolean(comparison?.owningHeads?.includes(head));
}

async function pendingWorktree(
  pending: ReturnType<typeof pendingRun>,
  request: StageRequest,
  binding: Extract<import('../../capabilities/job/index.js').Observation, { kind: 'found' }>,
  signal: AbortSignal
) {
  if (!pending || !needsWorktree(pending, request, binding.status)) return pending;
  const commit = (await command('git', ['rev-parse', 'HEAD'], binding.worktree, signal)).trim();
  const dirty = (await command('git', ['status', '--porcelain'], binding.worktree, signal)).trim();
  return {
    ...pending,
    commit,
    worktreeClean: !dirty,
    waitingForGitHub: pending.waitingForGitHub && !dirty,
  };
}
function needsWorktree(
  pending: NonNullable<ReturnType<typeof pendingRun>>,
  request: StageRequest,
  status: string
) {
  return (
    pending.waitingForGitHub ||
    (['publication', 'babysitting'].includes(request.stage) &&
      ['failed', 'interrupted'].includes(status))
  );
}
