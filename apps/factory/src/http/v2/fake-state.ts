import { createHash } from 'node:crypto';
import type {
  EntityChange,
  FactoryV2Changes,
  FactoryV2Command,
  FactoryV2CommandReceipt,
  FactoryV2Delta,
  FactoryV2IssueSearch,
  FactoryV2ItemDetails,
  FactoryV2PlanDetails,
  FactoryV2Problem,
  FactoryV2Snapshot,
  PlanAttempt,
  Tables,
  WorkItem,
} from './contract.js';
import {
  cancelId,
  fakeActions,
  fakeFixture,
  fakeJob,
  fakeScope,
  fakeThread,
  factorySource,
  known,
  resumeId,
} from './fake-fixture.js';
import { cursorSchema, decode, encode, pageSchema, problem } from './protocol.js';

type Submitted =
  | { readonly status: 200 | 202; readonly receipt: FactoryV2CommandReceipt }
  | FactoryV2Problem;
function diff<Value extends { readonly id: string }>(
  before: Readonly<Record<string, Value>>,
  after: Readonly<Record<string, Value>>
) {
  const result: (
    | { operation: 'upsert'; entity: Value }
    | { operation: 'remove'; id: Value['id'] }
  )[] = [];
  for (const value of Object.values(after))
    if (JSON.stringify(before[value.id]) !== JSON.stringify(value))
      result.push({ operation: 'upsert', entity: value });
  for (const value of Object.values(before))
    if (!Object.hasOwn(after, value.id)) result.push({ operation: 'remove', id: value.id });
  return result;
}
function entityChanges(before: Tables, after: Tables): EntityChange[] {
  return [
    ...diff(before.repositories, after.repositories).map((change) => ({
      table: 'repositories' as const,
      ...change,
    })),
    ...diff(before.sources, after.sources).map((change) => ({
      table: 'sources' as const,
      ...change,
    })),
    ...diff(before.users, after.users).map((change) => ({ table: 'users' as const, ...change })),
    ...diff(before.labels, after.labels).map((change) => ({ table: 'labels' as const, ...change })),
    ...diff(before.issues, after.issues).map((change) => ({ table: 'issues' as const, ...change })),
    ...diff(before.pullRequests, after.pullRequests).map((change) => ({
      table: 'pullRequests' as const,
      ...change,
    })),
    ...diff(before.relationships, after.relationships).map((change) => ({
      table: 'relationships' as const,
      ...change,
    })),
    ...diff(before.stacks, after.stacks).map((change) => ({ table: 'stacks' as const, ...change })),
    ...diff(before.threads, after.threads).map((change) => ({
      table: 'threads' as const,
      ...change,
    })),
    ...diff(before.jobs, after.jobs).map((change) => ({ table: 'jobs' as const, ...change })),
    ...diff(before.maintenance, after.maintenance).map((change) => ({
      table: 'maintenance' as const,
      ...change,
    })),
    ...diff(before.items, after.items).map((change) => ({ table: 'items' as const, ...change })),
    ...diff(before.actions, after.actions).map((change) => ({
      table: 'actions' as const,
      ...change,
    })),
    ...diff(before.plans, after.plans).map((change) => ({ table: 'plans' as const, ...change })),
  ];
}

/** Process-local sample projection. Never calls a live factory port or provider. */
export function fakeState(epoch: string, now: () => number, historyLimit: number) {
  let revision = 0;
  const cursor = () => encode({ scope: fakeScope, epoch, revision });
  let snapshot = fakeFixture(cursor(), new Date(now()).toISOString());
  const history: { revision: number; delta: FactoryV2Delta }[] = [];
  const listeners = new Set<() => void>();
  const receipts = new Map<string, { fingerprint: string; receipt: FactoryV2CommandReceipt }>();
  let pending = false,
    closed = false,
    inputVersion = '1';
  const readChanges = (after: string): FactoryV2Changes | FactoryV2Problem => {
    const parsed = decode(after, cursorSchema);
    if (!parsed) return problem(400, 'invalid-request', 'Invalid change cursor.');
    if (parsed.scope !== fakeScope) return { kind: 'resync-required', reason: 'different-scope' };
    if (parsed.epoch !== epoch || parsed.revision > revision)
      return { kind: 'resync-required', reason: 'reset' };
    if (parsed.revision < revision - history.length)
      return { kind: 'resync-required', reason: 'expired' };
    if (parsed.revision === revision) return { kind: 'unchanged', cursor: snapshot.cursor };
    const selected = history.filter((entry) => entry.revision > parsed.revision).slice(0, 32);
    const last = selected.at(-1);
    if (!last) return { kind: 'resync-required', reason: 'expired' };
    return {
      kind: 'changes',
      batches: selected.map((entry) => entry.delta),
      nextCursor: last.delta.toCursor,
      hasMore: last.revision < revision,
    };
  };
  const commit = (next: FactoryV2Snapshot) => {
    const previous = snapshot;
    revision++;
    snapshot = { ...next, cursor: cursor() };
    const delta: FactoryV2Delta = {
      apiVersion: 2,
      scopeId: fakeScope,
      fromCursor: previous.cursor,
      toCursor: snapshot.cursor,
      committedAt: snapshot.committedAt,
      changes: entityChanges(previous.entities, snapshot.entities),
      meta: snapshot.meta,
    };
    history.push({ revision, delta });
    if (history.length > historyLimit) history.shift();
    for (const listener of listeners) listener();
  };
  const apply = (command: FactoryV2Command) => {
    const stored = receipts.get(command.commandId);
    if (!stored || closed) return;
    const action = snapshot.entities.actions[command.actionId];
    const at = new Date(now()).toISOString(),
      version = String(revision + 2);
    let entities = snapshot.entities,
      meta = snapshot.meta;
    let result: FactoryV2CommandReceipt['result'] = null;
    if (command.kind === 'configure') {
      meta = {
        ...meta,
        factory: {
          ...meta.factory,
          version,
          paused: command.payload.paused,
          concurrency: { ...meta.factory.concurrency, limit: command.payload.concurrency },
          admission: { ...meta.factory.admission, limit: command.payload.admissionAllowance },
        },
      };
    } else if (command.kind === 'start') {
      const issue = Object.values(entities.issues).find((entry) => entry.id === action.targetId);
      if (!issue) throw new Error('Sample start target missing');
      const job = fakeJob(issue.number, at),
        thread = fakeThread(issue.number, at);
      entities = {
        ...entities,
        jobs: { ...entities.jobs, [job.id]: job },
        threads: { ...entities.threads, [thread.id]: thread },
        items: Object.fromEntries(
          Object.values(entities.items).map((entry): [string, WorkItem] => [
            entry.id,
            entry.subject.kind === 'issue' && entry.subject.issueId === issue.id
              ? {
                  ...entry,
                  version,
                  section: 'working',
                  status: { code: 'implementing', label: 'Implementing', active: true, since: at },
                  jobIds: [job.id],
                  threadIds: [thread.id],
                  actionIds: [resumeId(issue.number), cancelId(issue.number)],
                }
              : entry,
          ])
        ),
      };
      meta = {
        ...meta,
        factory: {
          ...meta.factory,
          version,
          concurrency: {
            ...meta.factory.concurrency,
            occupied: meta.factory.concurrency.occupied + 1,
          },
          admission: { ...meta.factory.admission, consumed: meta.factory.admission.consumed + 1 },
        },
      };
      result = { jobId: job.id };
    } else if (command.kind === 'resume' || command.kind === 'cancel') {
      const job = Object.values(entities.jobs).find((entry) => entry.id === action.targetId);
      if (!job) throw new Error('Sample job target missing');
      const resume = command.kind === 'resume';
      const changedJob = {
        ...job,
        version,
        cancelled: !resume,
        occupiesCapacity: resume,
        activity: resume ? 'implementing' : 'cancelled',
        activityStartedAt: at,
        execution: known(
          {
            runId: `demo-${version}`,
            state: resume ? ('running' as const) : ('interrupted' as const),
          },
          at
        ),
        progress: 'Simulated command completed. No real thread was contacted.',
      };
      entities = {
        ...entities,
        jobs: { ...entities.jobs, [job.id]: changedJob },
        items: Object.fromEntries(
          Object.values(entities.items)
            .filter((entry) => resume || !entry.jobIds.includes(job.id))
            .map((entry): [string, WorkItem] => [
              entry.id,
              entry.jobIds.includes(job.id)
                ? {
                    ...entry,
                    version,
                    status: {
                      code: 'implementing',
                      label: 'Implementing',
                      active: true,
                      since: at,
                    },
                    attention: { state: 'none', sourceIds: [factorySource] },
                  }
                : entry,
            ])
        ),
      };
      meta = {
        ...meta,
        factory: {
          ...meta.factory,
          version,
          concurrency: {
            ...meta.factory.concurrency,
            occupied:
              meta.factory.concurrency.occupied +
              (resume ? (job.occupiesCapacity ? 0 : 1) : job.occupiesCapacity ? -1 : 0),
          },
        },
      };
      result = { jobId: job.id };
    } else {
      const id: PlanAttempt['id'] = `plan:${command.commandId}`;
      const attempt: PlanAttempt = {
        id,
        version,
        startedAt: at,
        deadline: new Date(now() + 60000).toISOString(),
        finishedAt: at,
        phase: 'succeeded',
        progress: 'Simulated advisory plan. Nothing was dispatched.',
        threadId: null,
        basis: { boardCursor: snapshot.cursor, inputVersion, controlVersion: meta.factory.version },
        applicability: 'current',
        result: {
          selected: Object.values(entities.issues)
            .filter(
              (issue) =>
                issue.eligibility.state === 'allowed' &&
                !Object.values(entities.jobs).some((job) => job.issueId === issue.id)
            )
            .map((issue) => ({
              issueId: issue.id,
              reason: 'Eligible sample work.',
              dependsOn: [],
              conflicts: [],
            })),
          deferred: [],
          rejected: [],
        },
      };
      entities = {
        ...entities,
        plans: Object.fromEntries(
          [...Object.values(entities.plans).slice(-31), attempt].map((entry) => [entry.id, entry])
        ),
      };
      meta = { ...meta, currentPlanId: id };
      result = { planId: id };
    }
    if (command.kind !== 'preview-plan') {
      inputVersion = version;
      entities = {
        ...entities,
        plans: Object.fromEntries(
          Object.values(entities.plans).map((entry) => [
            entry.id,
            { ...entry, version, applicability: 'stale' as const },
          ])
        ),
      };
    }
    const source = entities.sources[factorySource];
    entities = {
      ...entities,
      sources: {
        ...entities.sources,
        [factorySource]: { ...source, version, observedAt: at, lastAttemptAt: at },
      },
    };
    const next = { ...snapshot, committedAt: at, entities, meta };
    commit({ ...next, entities: { ...entities, actions: fakeActions(next, version) } });
    stored.receipt = {
      ...stored.receipt,
      version,
      state: 'succeeded',
      completedAt: at,
      result,
      resultingCursor: snapshot.cursor,
    };
  };
  return {
    snapshot: () => snapshot,
    changes: readChanges,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    receipt: (id: string) => receipts.get(id)?.receipt,
    submit(command: FactoryV2Command): Submitted {
      const fingerprint = createHash('sha256').update(JSON.stringify(command)).digest('hex');
      const existing = receipts.get(command.commandId);
      if (existing)
        return existing.fingerprint === fingerprint
          ? { status: existing.receipt.state === 'accepted' ? 202 : 200, receipt: existing.receipt }
          : problem(
              409,
              'id-reused',
              'This command ID is already bound to a different request.',
              command.commandId
            );
      if (closed || receipts.size >= 512)
        return problem(
          503,
          'unavailable',
          'The sample server is closed or its bounded command ledger is full.',
          command.commandId
        );
      if (pending)
        return problem(
          409,
          'command-rejected',
          'Another simulated command is pending.',
          command.commandId
        );
      const action = snapshot.entities.actions[command.actionId];
      if (!action) return problem(404, 'not-found', 'Unknown action.', command.commandId);
      if (action.kind !== command.kind)
        return problem(
          400,
          'invalid-request',
          'Command kind does not match its action.',
          command.commandId
        );
      if (action.availability.state !== 'available')
        return problem(
          422,
          'command-rejected',
          'The action is unavailable in the current sample state.',
          command.commandId
        );
      if (
        action.availability.precondition !== command.precondition ||
        (action.availability.validUntil !== null &&
          Date.parse(action.availability.validUntil) <= now())
      )
        return problem(
          409,
          'stale-action',
          'The action changed. Refresh the board.',
          command.commandId
        );
      const receipt: FactoryV2CommandReceipt = {
        commandId: command.commandId,
        version: '1',
        actionId: action.id,
        state: 'accepted',
        acceptedAt: new Date(now()).toISOString(),
        completedAt: null,
        reasons: [],
        result: null,
        resultingCursor: null,
      };
      const stored = { fingerprint, receipt };
      receipts.set(command.commandId, stored);
      pending = true;
      queueMicrotask(() => {
        try {
          apply(command);
        } catch {
          stored.receipt = {
            ...receipt,
            state: 'rejected',
            version: '2',
            completedAt: new Date(now()).toISOString(),
            reasons: [
              { code: 'fake-failure', message: 'The simulated command could not complete.' },
            ],
          };
        } finally {
          pending = false;
        }
      });
      return { status: 202, receipt };
    },
    search(query: string, limit: number, token?: string): FactoryV2IssueSearch | FactoryV2Problem {
      const normalized = query.trim().replace(/^#/, '').toLowerCase();
      const page = token === undefined ? undefined : decode(token, pageSchema);
      if (token !== undefined && (!page || page.query !== normalized))
        return problem(400, 'invalid-request', 'Invalid search page token or query.');
      if (page && page.cursor !== snapshot.cursor)
        return problem(409, 'stale-action', 'The search index changed. Restart the search.');
      const matches = Object.values(snapshot.entities.issues)
        .filter(
          (issue) =>
            issue.metadata.state === 'known' &&
            `${issue.number} ${issue.metadata.value.title}`.toLowerCase().includes(normalized)
        )
        .sort((a, b) => a.number - b.number);
      const offset = page?.offset ?? 0;
      if (offset > matches.length)
        return problem(400, 'invalid-request', 'Invalid search page offset.');
      const selected = matches.slice(offset, offset + limit);
      return {
        apiVersion: 2,
        query,
        nextPageToken:
          offset + limit < matches.length
            ? encode({ cursor: snapshot.cursor, query: normalized, offset: offset + limit })
            : null,
        coverage: snapshot.meta.coverage,
        sources: snapshot.entities.sources,
        hits: selected.map((issue) => ({
          issue,
          startAction: snapshot.entities.actions[`action:start-${issue.number}`],
        })),
        users: snapshot.entities.users,
        labels: snapshot.entities.labels,
        repositories: snapshot.entities.repositories,
      };
    },
    details(id: string): FactoryV2ItemDetails | undefined {
      const item = Object.values(snapshot.entities.items).find((entry) => entry.id === id);
      if (!item) return undefined;
      const pr =
        item.subject.kind === 'pull-request'
          ? snapshot.entities.pullRequests[item.subject.pullRequestId]
          : undefined;
      const checks = pr?.checks;
      return {
        apiVersion: 2,
        itemId: item.id,
        itemVersion: item.version,
        observedAt: snapshot.committedAt,
        questions: [],
        checkRuns:
          checks?.state === 'unknown'
            ? checks
            : known(
                checks?.value.groups.map((group) => ({
                  id: group.id,
                  groupId: group.id,
                  name: group.name,
                  url: group.url,
                  comparison: checks.value.comparison,
                  state: group.state,
                  startedAt: checks.observedAt,
                  completedAt: group.state === 'passed' ? checks.observedAt : null,
                })) ?? [],
                checks?.observedAt ?? snapshot.committedAt
              ),
      };
    },
    plan(id: string): FactoryV2PlanDetails | undefined {
      const attempt = Object.values(snapshot.entities.plans).find((entry) => entry.id === id);
      if (!attempt) return undefined;
      const { issues, repositories, labels, users, sources, threads } = snapshot.entities;
      return {
        apiVersion: 2,
        attempt,
        entities: { issues, repositories, labels, users, sources, threads },
      };
    },
    close: () => {
      closed = true;
      listeners.clear();
    },
  };
}
