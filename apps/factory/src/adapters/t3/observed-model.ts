import { z } from 'zod';

export const entity = z.object({ id: z.string().min(1) }).passthrough();
export const shell = entity
  .extend({
    projectId: z.string(),
    title: z.string(),
    lineage: z.object({ parentThreadId: z.string().nullable() }).passthrough(),
    status: z.string(),
    latestRunId: z.string().nullable(),
    activeRunId: z.string().nullable(),
    blockedOnThreadWait: z.boolean().optional(),
    pendingBackgroundTasks: z.array(z.unknown()).optional(),
    pullRequests: z.array(z.record(z.unknown())).optional(),
  })
  .passthrough();
export const projection = z
  .object({
    thread: entity,
    runs: z.array(entity),
    attempts: z.array(entity),
    runtimeRequests: z.array(entity),
    providerThreads: z.array(entity),
    messages: z.array(entity),
    turnItems: z.array(entity),
  })
  .passthrough();
export type Projection = z.infer<typeof projection>;
export type Shell = z.infer<typeof shell>;
const updateCollections: Record<string, string> = {
  'run.created': 'runs',
  'run.updated': 'runs',
  'run-attempt.created': 'attempts',
  'run-attempt.updated': 'attempts',
  'node.updated': 'nodes',
  'subagent.updated': 'subagents',
  'provider-session.attached': 'providerSessions',
  'provider-session.updated': 'providerSessions',
  'provider-thread.updated': 'providerThreads',
  'provider-turn.updated': 'providerTurns',
  'runtime-request.updated': 'runtimeRequests',
  'message.updated': 'messages',
  'turn-item.updated': 'turnItems',
  'plan.updated': 'plans',
  'checkpoint-scope.created': 'checkpointScopes',
  'checkpoint.captured': 'checkpoints',
  'context-handoff.updated': 'contextHandoffs',
  'context-transfer.created': 'contextTransfers',
  'context-transfer.updated': 'contextTransfers',
};
const threadUpdates = new Set([
  'created',
  'archived',
  'unarchived',
  'deleted',
  'settled',
  'unsettled',
  'snoozed',
  'unsnoozed',
  'pinned',
  'unpinned',
  'pin-reordered',
  'active-reordered',
  'visited',
  'marked-unread',
  'metadata-updated',
  'pull-request-synced',
  'runtime-mode-updated',
  'interaction-mode-updated',
  'model-selection-updated',
  'provider-switched',
  'auto-settle-set',
]);

export function applyObservedEvent(current: Projection, raw: unknown): Projection {
  const event = z
    .object({ threadId: z.literal(current.thread.id), type: z.string(), payload: z.unknown() })
    .parse(raw);
  const key = updateCollections[event.type];
  if (key) {
    const next = entity.parse(event.payload);
    const items = z.array(entity).parse(current[key] ?? []);
    return {
      ...current,
      [key]: [...items.filter((item) => item.id !== next.id), next],
    };
  }
  if (event.type.startsWith('thread.') && threadUpdates.has(event.type.slice(7))) {
    return {
      ...current,
      thread: entity.extend({ id: z.literal(current.thread.id) }).parse(event.payload),
    };
  }
  if (event.type === 'thread.pull-request-link-updated') {
    const link = z.object({ url: z.string() }).passthrough().parse(event.payload);
    const links = z
      .array(z.object({ url: z.string() }).passthrough())
      .parse(current.thread.pullRequests ?? []);
    return {
      ...current,
      thread: {
        ...current.thread,
        pullRequests: [...links.filter((value) => value.url !== link.url), link],
      },
    };
  }
  if (event.type === 'provider-session.detached') {
    const { providerSessionId } = z.object({ providerSessionId: z.string() }).parse(event.payload);
    return {
      ...current,
      providerSessions: z
        .array(entity)
        .parse(current.providerSessions ?? [])
        .filter((value) => value.id !== providerSessionId),
    };
  }
  if (event.type === 'run.background-work-cancelled') {
    const change = z
      .object({ runId: z.string(), restartCancelledBackgroundWork: z.array(z.unknown()) })
      .parse(event.payload);
    return {
      ...current,
      runs: current.runs.map((run) =>
        run.id === change.runId
          ? { ...run, restartCancelledBackgroundWork: change.restartCancelledBackgroundWork }
          : run
      ),
    };
  }
  if (event.type === 'checkpoint.rollback-requested') return current;
  throw new Error('Unsupported T3 event requires an authoritative snapshot');
}

export function observedThread(value: Projection, metadata?: Shell) {
  const thread = z
    .object({
      id: z.string(),
      projectId: z.string(),
      title: z.string(),
      modelSelection: z.object({ instanceId: z.string(), model: z.string() }).passthrough(),
      branch: z.string().nullable(),
      worktreePath: z.string().nullable(),
    })
    .passthrough()
    .parse(value.thread);
  const runs = z
    .array(entity.extend({ ordinal: z.number(), status: z.string() }))
    .parse(value.runs)
    .sort((a, b) => b.ordinal - a.ordinal);
  const active = runs.find((run) =>
    ['preparing', 'queued', 'starting', 'running', 'waiting'].includes(run.status)
  );
  const latest = runs[0];
  return {
    ...thread,
    threadId: thread.id,
    providerInstanceId: thread.modelSelection.instanceId,
    model: thread.modelSelection.model,
    runCount: runs.length,
    latestRunId: latest?.id ?? null,
    activeRunId: active?.id ?? null,
    status: active?.status ?? latest?.status ?? 'idle',
    pendingRequestCount: value.runtimeRequests.filter((request) => request.status === 'pending')
      .length,
    blockedOnThreadWait: metadata?.blockedOnThreadWait,
    pendingBackgroundTasks: metadata?.pendingBackgroundTasks,
    pullRequests: value.thread.pullRequests,
  };
}

/** Match the supported timeline's rollback, queued-input and superseded-interrupt visibility. */
function visible(value: Projection, item: z.infer<typeof entity>) {
  const run = value.runs.find((candidate) => candidate.id === item.runId);
  if (run?.status === 'rolled_back') return false;
  if (
    item.type === 'user_message' &&
    item.inputIntent === 'queued_turn' &&
    run?.status === 'cancelled'
  )
    return false;
  return !(
    item.type === 'run_interrupt_result' &&
    item.runId &&
    item.nodeId &&
    value.attempts.some(
      (attempt) =>
        attempt.runId === item.runId &&
        attempt.rootNodeId === item.nodeId &&
        attempt.status === 'superseded'
    ) &&
    !value.turnItems.some(
      (candidate) => candidate.type === 'run_interrupt_request' && candidate.runId === item.runId
    )
  );
}
function activityItems(value: Projection) {
  const messages = new Map(value.messages.map((message) => [message.id, message]));
  const items = value.turnItems
    .filter((item) => visible(value, item))
    .map((item) => {
      const parsed = entity
        .extend({
          threadId: z.string(),
          runId: z.string().nullable(),
          type: z.string(),
          ordinal: z.number(),
          status: z.string(),
        })
        .parse(item);
      const message = typeof item.messageId === 'string' ? messages.get(item.messageId) : undefined;
      return {
        itemId: parsed.id,
        sourceThreadId: parsed.threadId,
        visibility: 'local',
        runId: parsed.runId,
        type: parsed.type,
        status: parsed.status,
        position: parsed.ordinal,
        text:
          typeof item.text === 'string'
            ? item.text
            : item.type === 'user_input_request'
              ? JSON.stringify(item.questions)
              : null,
        createdBy: message?.createdBy ?? null,
        creationSource: message?.creationSource ?? null,
      };
    })
    .sort((a, b) => a.position - b.position);
  return Object.freeze(items.map((item) => Object.freeze(item)));
}
const timelines = new WeakMap<Projection, ReturnType<typeof activityItems>>();
export function observedActivity(value: Projection, metadata?: Shell) {
  let items = timelines.get(value);
  if (!items) {
    items = activityItems(value);
    timelines.set(value, items);
  }
  return {
    thread: observedThread(value, metadata),
    recentRuns: value.runs.map((run) => {
      const parsed = entity
        .extend({ startedAt: z.string().datetime({ offset: true }).nullish() })
        .parse(run);
      return { runId: parsed.id, startedAt: parsed.startedAt ?? null };
    }),
    items,
    hasMore: false,
    nextPosition: items.at(-1)?.position ?? null,
  };
}
