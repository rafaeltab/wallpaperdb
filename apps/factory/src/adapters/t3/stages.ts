import { executionInstructions } from './execution-settings.js';
import { Effect } from 'effect';
import { z } from 'zod';
import {
  type Execution,
  type Intent,
  type StageRequest,
  type ReconciliationReason,
  stageDeliveryIndex,
  Unavailable,
} from '../../capabilities/job/index.js';
import { command } from '../../platform/index.js';
import { verifiedComparison } from './comparison.js';
import { receiptSchema, responseShape, latestStructured, responseValue } from './response.js';

const historyWindow = 1000;
export function receiptInstructions(
  intent: Intent,
  stage: StageRequest['stage'],
  delivery = `${intent.id}:0`
) {
  return `Factory instruction ${delivery}. Return one JSON object matching the following TypeScript union as your final response:
\`\`\`typescript
${responseShape}
\`\`\`
Use version 1, jobId=${JSON.stringify(intent.id)}, implemented=${JSON.stringify(String(intent.issue))} and report your actual comparison in base, initially ${JSON.stringify(intent.base)}. A newer main comparison must preserve the allowed boundary and required unmerged prerequisites. The factory verifies ancestry independently. Unexpected feature bases require manual recovery. If required issue code is missing, use the dependencies response; do not invent a stack. Every true check attests successful required local validation at checked, including formatting and lint. Established repository exemptions require a reason in the retained evidence. checked must match the current clean owning HEAD. ${stage === 'implementation' ? '' : 'reviewed must match checked and attest fresh independent Standards, Spec and Defects reviews at that commit.'} ${['publication', 'babysitting'].includes(stage) ? 'published must also match checked and the authoritative linked PR head.' : ''} Keep detailed validation, review and demonstration evidence in the outside-repository ledger. If prerequisite work is needed, return the dependencies variant without claiming completion or successful checks. Do not invent successful checks or a waiting outcome. Registered waits and PR watchers keep you busy until their continuations settle.`;
}
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
              !request.handback &&
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
            if (binding.run && binding.run.id !== detail.thread.latestRunId) return null;
            // A manual instruction starts new work, not a new factory stage.
            // Keep the factory boundary while excluding receipts from before that work.
            if (binding.manual) {
              const instruction = instructionBoundary(detail.messages, intent, request);
              const message = [...detail.messages]
                .reverse()
                .find((m) => m.role === 'user' && m.runId === binding.manual?.runId);
              const manual = message ? detail.messages.indexOf(message) : -1;
              detail.messages = [
                ...detail.messages.slice(0, instruction + 1),
                ...(manual > instruction ? detail.messages.slice(manual) : []),
              ];
            }
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
              const pending = pendingRun(detail, request, intent);
              return pendingWorktree(
                pending ? { ...pending, idle: false, waitingForGitHub: true } : null,
                binding,
                signal
              );
            }
            const observed = outcome(detail, intent, request);
            if (!observed) {
              const pending = pendingRun(detail, request, intent);
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
              const pending = pendingRun(detail, request, intent);
              return pending
                ? {
                    ...pending,
                    commit,
                    worktreeClean: !dirty,
                    rejection: {
                      kind: dirty ? ('checkout-dirty' as const) : ('head-mismatch' as const),
                    },
                  }
                : null;
            }
            const comparison = await verifiedComparison(
              binding.worktree,
              original,
              intent,
              result.base,
              commit,
              Boolean(request.comparison),
              signal
            );
            if (!comparison) {
              const pending = pendingRun(detail, request, intent);
              return pending
                ? {
                    ...pending,
                    commit,
                    worktreeClean: true,
                    unexpectedBase: true,
                    rejection: { kind: 'comparison-unverified' as const },
                  }
                : null;
            }
            return {
              base: result.base,
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
  const comparison = request.comparison
    ? { ...intent, base: request.comparison.base, prBase: request.comparison.prBase }
    : intent;
  return request.acceptedBase ? { ...comparison, base: request.acceptedBase } : comparison;
}
function stagePrompt(intent: Intent, request: StageRequest, prBase: string) {
  const scope = `Only ${intent.issueUrl} is authorized. Preserve retained scope and decisions. Only rafaeltab and zero-two-rafaeltab may expand scope. Retained context: ${intent.context}`;
  if (request.handback)
    return `Reconcile your latest dependency response with the factory-validated list below before any side effect. If your latest requested dependencies differ, return the corrected dependencies response and stop without recording unvalidated relationships. Reuse already observed effects and verify current outcomes before acting. Abandon this attempt for validated prerequisites ${JSON.stringify(request.handback)}. Stage ${request.index} of factory job ${intent.id}. ${scope}. Record the blocking edges through the repository GitHub dependency conventions, reusing existing edges and native dependencies where supported, documented body fallback otherwise. Do not relabel or admit prerequisites. Close only an open PR for this attempt's exact branch ${intent.branch}; retain branches, thread, worktree, scope decisions and audit evidence. Leave issue ${intent.issueUrl} open and restore its agreed plan status Planned. Do not clean Git or implement more work. Reread edges, PR closure and project status. Return the same version 1 dependencies response with jobId=${JSON.stringify(intent.id)} and requireUnimplementedIssues=${JSON.stringify(request.handback)}. ${receiptInstructions(intent, request.stage, deliveryIdentity(intent, request))}`;
  if (request.reconciliation) return reconciliationPrompt(intent, request, scope);
  if (request.resume && request.stage !== 'babysitting')
    return resumePrompt(intent, request, scope);
  if (request.stage === 'babysitting')
    return `${request.continuation || request.resume ? 'continue. ' : ''}Use $babysit-pr for ${intent.issueUrl} in this existing bound thread/worktree. Stage ${request.index} of factory job ${intent.id}; delivery ${deliveryIdentity(intent, request)}. Failed applicable CI requires repair; actual code repairs require affected independent Standards/Spec/Defects re-review before readiness. Only the selected issue and retained agreed scope are authorized; significant proposals return to the coordinator. Preserve manual babysitting behavior, use factory policy: mutation and hosted approval advisory, no automerge or issue closure. ${scope}. ${replayInstructions(request)} Reconcile current GitHub CI and any existing watcher before acting. If CI is already successful, verify and return the required receipt without starting another watcher, retrying CI or editing code. Keep questions here. ${receiptInstructions(intent, request.stage, deliveryIdentity(intent, request))}`;
  const skill = request.stage === 'review' ? '$review-loop' : '$publish-pr';
  return `Use ${skill} for ${intent.issueUrl} against PR target ${prBase}, pinned comparison ${intent.base}, in this existing bound checkout. Stage ${request.index} of factory job ${intent.id}; delivery ${deliveryIdentity(intent, request)}; accepted predecessor commit ${request.commit}; reviewed starting commit ${request.commit}. Preserve all requirements, decisions, validation and demo handoffs in this thread. Only this issue is authorized. ${executionInstructions(intent.execution)} Publication must reconcile an existing PR before creating one, keep it concise, link it in T3, leave the issue open, and stop before CI repairs or merging. Mutation and hosted approval are advisory. ${receiptInstructions(intent, request.stage, deliveryIdentity(intent, request))}`;
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
  const parsed = receiptSchema.safeParse(responseValue(text));
  return parsed.success ? parsed.data : null;
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
  const workflow = {
    implementation:
      'Use $implement to finish the existing implementation and required local validation. No PR is expected in this stage. Stop before independent review and publication; the factory requests review-loop after it accepts implementation. If an unrelated check failure or scope decision blocks completion, ask the maintainer an accurate question in this thread and wait without claiming success or expanding scope.',
    review:
      'Use $review-loop for the existing implementation and pinned comparison. Run its independent read-only reviewers for Standards, Spec and Defects, and perform authorized repairs and validation. Stop before publication. Report reviewed equal to checked only after all required review evidence applies.',
    publication:
      'Use $publish-pr after verifying the current validation and independent reviews. Inspect and reuse the intended PR if one exists. If no PR exists, create the first PR for this issue after the publication prerequisites are satisfied. Never create a duplicate or blindly publish local HEAD. Necessary publication code repairs require applicable local checks and fresh independent review before publication.',
    babysitting:
      'Use $babysit-pr for the existing publication. Verify current-head CI and repair required failures within scope. Code repairs require applicable validation and independent re-review. Do not merge or close the issue.',
    ci: 'Use $babysit-pr for the existing publication. Verify current-head CI and retain the accepted publication. Required code repairs need applicable validation and independent re-review. Do not merge or close the issue.',
  };
  const migration =
    request.reconciliation === 'migration'
      ? 'Your response format is obsolete or unsupported. Migrate once to version 1 and verify the current state. '
      : '';
  return `Stage ${request.index} of factory job ${intent.id}; reconcile the existing ${request.stage} stage in this owning agent and checkout. ${migration}${rejectionDescription(request.reconciliationReason)} ${workflow[request.stage]} ${scope}. Continue in this owning worker and checkout. Do not launch a replacement implementation worker or create another worktree. Independent read-only reviewers required by the selected workflow are allowed. Preserve unrelated work, accepted stage history, the expected comparison, and cancellation and uncertain-effect safeguards. Reuse applicable existing evidence for an unchanged comparison; do not repeat completed stages merely to correct the response format. ${receiptInstructions(intent, request.stage, deliveryIdentity(intent, request))}`;
}

function rejectionDescription(reason: ReconciliationReason | undefined) {
  if (!reason)
    return 'The current stage has no accepted verified state. Inspect its actual validation and state before continuing.';
  if (reason.kind === 'checks-incomplete')
    return `The current state reports incomplete required checks: ${reason.checks.join(', ')}. These checks must pass before this stage can complete.`;
  const descriptions = {
    'response-missing':
      'No supported current state response was observed after the factory instruction.',
    'invalid-response': 'The latest state response does not match the supported receipt protocol.',
    'receipt-mismatch': 'The state response identifies another job or issue.',
    'instruction-unavailable':
      'The retained factory instruction could not be verified in the available history.',
    'review-unverified':
      'Independent review evidence does not match the checked commit for this stage.',
    'publication-unverified':
      'Publication evidence does not match the checked commit for this stage.',
    'checkout-dirty':
      'The owning checkout has uncommitted changes; completion requires a clean checked commit.',
    'head-mismatch': 'The reported checked commit does not match the current owning HEAD.',
    'comparison-unverified':
      'The reported comparison could not be verified against the allowed boundary.',
    'publication-mismatch':
      'The intended PR could not be verified at the checked commit with its owning thread association.',
  };
  return descriptions[reason.kind];
}

function pendingResponse(
  messages: z.infer<typeof stageDetail>['messages'],
  intent: Intent,
  request: StageRequest
) {
  const boundary = instructionBoundary(messages, intent, request);
  const message = latestStructured(boundary >= 0 ? messages.slice(boundary + 1) : messages);
  if (!message) return { rejection: { kind: 'response-missing' as const } };
  const value = responseValue(message.text);
  if (value === undefined)
    return { responseObserved: true, rejection: { kind: 'invalid-response' as const } };
  const parsed = receiptSchema.safeParse(value);
  const version = z.object({ version: z.unknown().optional() }).safeParse(value);
  return {
    responseObserved: true,
    rejection: rejectedState(parsed.success ? parsed.data : null, boundary, intent, request),
    migrationRequired:
      boundary >= 0 && parsed.success
        ? false
        : version.success && version.data.version !== 1
          ? true
          : undefined,
    dependencies:
      boundary >= 0 &&
      parsed.success &&
      parsed.data.jobId === intent.id &&
      parsed.data.kind === 'dependencies'
        ? parsed.data.requireUnimplementedIssues
        : undefined,
  };
}

function rejectedState(
  result: z.infer<typeof receiptSchema> | null,
  boundary: number,
  intent: Intent,
  request: StageRequest
): ReconciliationReason | undefined {
  if (boundary < 0) return { kind: 'instruction-unavailable' };
  if (!result) return { kind: 'invalid-response' };
  if (
    result.jobId !== intent.id ||
    (result.kind === 'state' && result.implemented !== String(intent.issue))
  )
    return { kind: 'receipt-mismatch' };
  if (result.kind !== 'state') return undefined;
  const checks = (['format', 'lint', 'tests', 'crap', 'coverage'] as const).filter(
    (check) => !result.checks[check]
  );
  if (checks.length) return { kind: 'checks-incomplete', checks };
  if (request.stage !== 'implementation' && result.reviewed !== result.checked)
    return { kind: 'review-unverified' };
  if (['publication', 'babysitting'].includes(request.stage) && result.published !== result.checked)
    return { kind: 'publication-unverified' };
  return undefined;
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
