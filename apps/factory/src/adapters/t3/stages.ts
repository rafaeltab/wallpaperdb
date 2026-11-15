import { Effect } from 'effect';
import { z } from 'zod';
import {
  type AgentResponse,
  type Execution,
  type Intent,
  type StageRequest,
  stageDeliveryIndex,
  Unavailable,
} from '../../capabilities/job/index.js';
import { command } from '../../platform/index.js';

const historyWindow = 1000;
const responseShape = `type AgentResponse =
  | { version: 1; kind: 'state'; jobId: string;
      checks: { format: boolean; lint: boolean; tests: boolean; crap: boolean; coverage: boolean };
      base: string; implemented: string; checked: string; reviewed?: string; published?: string }
  | { version: 1; kind: 'dependencies'; jobId: string; requireUnimplementedIssues: string[] };`;
export function receiptInstructions(
  intent: Intent,
  stage: StageRequest['stage'],
  delivery = `${intent.id}:0`
) {
  return `Factory instruction ${delivery}. Return one JSON object matching the following TypeScript union as your final response:
\`\`\`typescript
${responseShape}
\`\`\`
Use version 1, jobId=${JSON.stringify(intent.id)}, implemented=${JSON.stringify(String(intent.issue))} and base=${JSON.stringify(intent.base)}. Every true check attests successful required local validation at checked, including formatting and lint. Established repository exemptions require a reason in the retained evidence. checked must match the current clean owning HEAD. ${stage === 'implementation' ? '' : 'reviewed must match checked and attest fresh independent Standards, Spec and Defects reviews at that commit.'} ${['publication', 'babysitting'].includes(stage) ? 'published must also match checked and the authoritative linked PR head.' : ''} Keep detailed validation, review and demonstration evidence in the outside-repository ledger. Do not invent successful checks or a waiting outcome. Registered waits and PR watchers keep you busy until their continuations settle.`;
}
const receiptSchema = z.discriminatedUnion('kind', [
  z
    .object({
      version: z.literal(1),
      kind: z.literal('state'),
      jobId: z.string(),
      checks: z
        .object({
          format: z.boolean(),
          lint: z.boolean(),
          tests: z.boolean(),
          crap: z.boolean(),
          coverage: z.boolean(),
        })
        .strict(),
      base: z.string(),
      implemented: z.string(),
      checked: z.string(),
      reviewed: z.string().optional(),
      published: z.string().optional(),
    })
    .strict(),
  z
    .object({
      version: z.literal(1),
      kind: z.literal('dependencies'),
      jobId: z.string(),
      requireUnimplementedIssues: z.array(z.string()),
    })
    .strict(),
]) satisfies z.ZodType<AgentResponse>;
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
  linkedPullRequests: (threadId: string, signal?: AbortSignal) => Promise<string[]>,
  sendHelp: (signal?: AbortSignal) => Promise<string>,
  inactive: (
    threadId: string,
    runId: string | null,
    signal?: AbortSignal
  ) => Promise<'idle' | 'waiting' | 'busy'>,
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
            if ((await inactive(request.threadId, binding.run?.id ?? null, signal)) !== 'idle')
              throw new Error('Owning agent or descendant is not verified idle');
            const head = (
              await command('git', ['rev-parse', 'HEAD'], binding.worktree, signal)
            ).trim();
            if (
              !request.reconciliation &&
              (!request.resume || request.stage === 'publication') &&
              (!deliveryHead(head, request) ||
                (await command('git', ['status', '--porcelain'], binding.worktree, signal)).trim())
            )
              throw new Error('Accepted commit changed before stage delivery');
            if (sendMcp) {
              const response = await sendMcp(
                intent,
                request,
                stagePrompt(intent, request, publicationBase(intent, prBase)),
                signal
              );
              z.object({ threadId: z.literal(request.threadId) }).parse(response);
              return;
            }
            const help = await sendHelp(signal);
            const key = help.includes('--client-request-id')
              ? ['--client-request-id', `${intent.id}:stage:${request.index}`]
              : [];
            const response = await call(
              [
                'send',
                request.threadId,
                stagePrompt(intent, request, publicationBase(intent, prBase)),
                ...key,
              ],
              signal
            );
            z.object({ threadId: z.literal(request.threadId) }).parse(response);
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
            const detail = stageDetail.parse(raw);
            if (
              !['idle', 'completed', 'failed', 'interrupted', 'cancelled', 'rolled_back'].includes(
                detail.thread.status
              ) ||
              detail.thread.pendingRequestCount !== 0
            )
              return null;
            const activity = await inactive(request.threadId, detail.thread.latestRunId, signal);
            if (activity !== 'idle') {
              if (activity !== 'waiting') return null;
              const pending = pendingRun(raw, request, intent);
              return pendingWorktree(
                pending ? { ...pending, idle: false, waitingForGitHub: true } : null,
                binding,
                signal
              );
            }
            const observed = outcome(raw, intent, request);
            if (!observed) {
              const pending = pendingRun(raw, request, intent);
              return pendingWorktree(pending, binding, signal);
            }
            const { thread, result } = observed;
            const commit = (
              await command('git', ['rev-parse', 'HEAD'], binding.worktree, signal)
            ).trim();
            const dirty = (
              await command('git', ['status', '--porcelain'], binding.worktree, signal)
            ).trim();
            if (result.kind !== 'state' || result.checked !== commit || dirty) {
              // Rejecting success must not erase the exact owning run's evidence.
              const pending = pendingRun(raw, request, intent);
              return pending ? { ...pending, commit, worktreeClean: !dirty } : null;
            }
            return {
              runId: thread.latestRunId,
              ordinal: thread.runCount,
              commit,
              accepted: true,
              idle: true,
              worktreeClean: true,
              stageIndex: request.index,
              linked:
                thread.pullRequests?.map((pr) => pr.url) ??
                (request.stage === 'publication' || request.stage === 'babysitting'
                  ? await linkedPullRequests(request.threadId, signal)
                  : []),
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
  if (request.reconciliation) return reconciliationPrompt(intent, request, scope);
  if (request.resume && request.stage !== 'babysitting')
    return resumePrompt(intent, request, scope);
  if (request.stage === 'babysitting')
    return `${request.continuation || request.resume ? 'continue. ' : ''}Use $babysit-pr for ${intent.issueUrl} in this existing bound thread/worktree. Stage ${request.index} of factory job ${intent.id}; delivery ${deliveryIdentity(intent, request)}. Failed applicable CI requires repair; actual code repairs require affected independent Standards/Spec/Defects re-review before readiness. Only the selected issue and retained agreed scope are authorized; significant proposals return to the coordinator. Preserve manual babysitting behavior, use factory policy: mutation and hosted approval advisory, no automerge or issue closure. ${scope}. ${replayInstructions(request)} Reconcile current GitHub CI and any existing watcher before acting. If CI is already successful, verify and return the required receipt without starting another watcher, retrying CI or editing code. Keep questions here. ${receiptInstructions(intent, request.stage, deliveryIdentity(intent, request))}`;
  const skill = request.stage === 'review' ? '$review-loop' : '$publish-pr';
  return `Use ${skill} for ${intent.issueUrl} against PR target ${prBase}, pinned comparison ${intent.base}, in this existing bound checkout. Stage ${request.index} of factory job ${intent.id}; delivery ${deliveryIdentity(intent, request)}; accepted predecessor commit ${request.commit}; reviewed starting commit ${request.commit}. Preserve all requirements, decisions, validation and demo handoffs in this thread. Only this issue is authorized. All agents and fresh independent reviewers use gpt-6.1-sol. Publication must reconcile an existing PR before creating one, keep it concise, link it in T3, leave the issue open, and stop before CI repairs or merging. Mutation and hosted approval are advisory. ${receiptInstructions(intent, request.stage, deliveryIdentity(intent, request))}`;
}
function completed(thread: z.infer<typeof stageDetail>['thread'], request: StageRequest) {
  return (
    thread.threadId === request.threadId &&
    ['completed', 'idle'].includes(thread.status) &&
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
    result.kind === 'state' &&
    result.jobId === intent.id &&
    result.implemented === String(intent.issue) &&
    result.base === intent.base &&
    Object.values(result.checks).every(Boolean) &&
    (request.stage === 'implementation' || result.reviewed === result.checked) &&
    (!['publication', 'babysitting'].includes(request.stage) || result.published === result.checked)
  );
}
function outcome(raw: unknown, intent: Intent, request: StageRequest) {
  const detail = stageDetail.safeParse(raw);
  if (!detail.success || !completed(detail.data.thread, request)) return null;
  const { thread, messages } = detail.data;
  const boundary = instructionBoundary(messages, intent, request);
  if (boundary < 0) return null;
  const latest = latestStructured(messages.slice(boundary + 1));
  const result = latest ? parseReceipt(latest.text) : null;
  if (!result || !matchesReceipt(result, intent, request)) return null;
  return { thread: { ...thread, latestRunId: thread.latestRunId ?? '' }, result };
}

function pendingRun(raw: unknown, request: StageRequest, intent: Intent) {
  const detail = stageDetail.safeParse(raw);
  if (!detail.success) return null;
  const { thread } = detail.data;
  const waitingForGitHub = false;
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
    idle: true,
    ...pendingResponse(detail.data.messages, intent, request),
  };
}

function sendBinding(
  binding: import('../../capabilities/job/index.js').Observation,
  request: StageRequest
): binding is Extract<import('../../capabilities/job/index.js').Observation, { kind: 'found' }> {
  if (
    binding.kind !== 'found' ||
    binding.threadId !== request.threadId ||
    (request.comparison &&
      !['completed', 'idle', 'failed', 'interrupted', 'cancelled', 'rolled_back'].includes(
        binding.status
      )) ||
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
    ['completed', 'idle', 'interrupted', 'failed', 'cancelled', 'rolled_back'].includes(
      binding.status
    )
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
  binding: Extract<import('../../capabilities/job/index.js').Observation, { kind: 'found' }>,
  signal: AbortSignal
) {
  if (!pending) return null;
  const commit = (await command('git', ['rev-parse', 'HEAD'], binding.worktree, signal)).trim();
  const dirty = (await command('git', ['status', '--porcelain'], binding.worktree, signal)).trim();
  return { ...pending, commit, worktreeClean: !dirty };
}
function reconciliationPrompt(intent: Intent, request: StageRequest, scope: string) {
  return `Stage ${request.index} of factory job ${intent.id}; reconcile the existing ${request.stage} stage in this owning agent and checkout. ${request.reconciliation === 'migration' ? 'Your response format is obsolete or unsupported. Migrate once to version 1 and verify the current state.' : 'The reported state, required local checks, independent review, local Git or intended PR do not agree. Reconcile them before reporting completion.'} ${scope}. Do not launch another worker or create a duplicate PR. Inspect and reuse the intended linked PR. Decide which authorized changes belong in it; never blindly publish local HEAD. Preserve unrelated extra commits on another branch if necessary and restore the correct owning checkout. Necessary publication commits are allowed, but rerun applicable local checks and fresh independent Standards, Spec and Defects reviews at the final checked commit. Preserve the expected comparison and existing cancellation and uncertain-effect safeguards. ${receiptInstructions(intent, request.stage, deliveryIdentity(intent, request))}`;
}

function latestStructured(messages: z.infer<typeof stageDetail>['messages']) {
  return [...messages].reverse().find((m) => {
    if (m.role !== 'assistant') return false;
    try {
      const value = JSON.parse(m.text);
      return (
        value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        ('jobId' in value ||
          'version' in value ||
          value.kind === 'state' ||
          value.kind === 'dependencies')
      );
    } catch {
      return (
        /^\s*\{/.test(m.text) &&
        /"(?:jobId|version)"\s*:|"kind"\s*:\s*"(?:state|dependencies)"/.test(m.text)
      );
    }
  });
}
function pendingResponse(
  messages: z.infer<typeof stageDetail>['messages'],
  intent: Intent,
  request: StageRequest
) {
  const boundary = instructionBoundary(messages, intent, request);
  const message = latestStructured(boundary >= 0 ? messages.slice(boundary + 1) : messages);
  if (!message) return {};
  let value: Record<string, unknown>;
  try {
    value = JSON.parse(message.text);
  } catch {
    return {};
  }
  const parsed = receiptSchema.safeParse(value);
  return {
    migrationRequired: value.version !== 1,
    dependencies:
      boundary >= 0 &&
      parsed.success &&
      parsed.data.jobId === intent.id &&
      parsed.data.kind === 'dependencies'
        ? parsed.data.requireUnimplementedIssues
        : undefined,
  };
}

function instructionBoundary(
  messages: z.infer<typeof stageDetail>['messages'],
  intent: Intent,
  request: StageRequest
) {
  const instruction = [...messages]
    .reverse()
    .find(
      (m) =>
        m.role === 'user' &&
        m.text.includes(`Factory instruction ${deliveryIdentity(intent, request)}.`)
    );
  return instruction ? messages.indexOf(instruction) : -1;
}
