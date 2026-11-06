import type { ScheduleSnapshot, ObservedUser, ObservedLabel } from '../observe/index.js';
import { capacityOccupied, holdsSlot } from '../plan/index.js';
import type {
  FactoryV2Snapshot,
  Tables,
  WorkItem,
  Fact,
  Source,
  Decision,
  Readiness,
  FactoryV2ItemDetails,
} from './model.js';
import { entity, known, unknown, timestamp, issueId, pullId, jobId, threadId } from './values.js';
const gh = 'source:github',
  local = 'source:factory',
  t3 = 'source:t3';
const repositoryId = 'repository:rafaeltab/wallpaperdb';
export function source(
  kind: Source['kind'],
  input: { observedAt?: number; startedAt?: number; failedAt?: number; error?: string }
): Source {
  return entity({
    id: `source:${kind}` as const,
    kind,
    observedAt: timestamp(input.observedAt),
    staleAt:
      input.observedAt === undefined || kind === 'factory'
        ? null
        : timestamp(input.observedAt + 240000),
    refresh: input.error
      ? ('failed' as const)
      : input.observedAt === undefined
        ? ('unavailable' as const)
        : (input.startedAt ?? 0) > input.observedAt
          ? ('refreshing' as const)
          : ('idle' as const),
    lastAttemptAt: timestamp(input.startedAt),
    nextAttemptAt:
      input.startedAt === undefined || kind === 'factory'
        ? null
        : timestamp(input.startedAt + 120000),
    failure: input.error
      ? {
          code: 'provider-unavailable',
          message: 'Refresh failed. Retained facts remain dated by their source.',
        }
      : null,
  });
}
const reason = (code: string, message: string) => ({ code, message });
const decision = (state: Decision['state'], message: string): Decision => ({
  state,
  reasons: message ? [reason(state, message)] : [],
  sourceIds: [gh, local],
});
const limit = (value: number): import('./model.js').Limit =>
  value === -1 ? { kind: 'unlimited' } : { kind: 'limited', maximum: value };
export function project(input: ScheduleSnapshot, at: string, scopeId: string, cursor: string) {
  const tables: {
    -readonly [K in keyof Tables]: { -readonly [Id in keyof Tables[K]]: Tables[K][Id] };
  } = {
    repositories: {},
    sources: {},
    users: {},
    labels: {},
    issues: {},
    pullRequests: {},
    relationships: {},
    stacks: {},
    threads: {},
    jobs: {},
    maintenance: {},
    items: {},
    actions: {},
    plans: {},
  };
  const details: Record<string, FactoryV2ItemDetails> = {};
  tables.repositories[repositoryId] = entity({
    id: repositoryId,
    owner: 'rafaeltab',
    name: 'wallpaperdb',
    url: 'https://github.com/rafaeltab/wallpaperdb',
    defaultBranch: 'main',
  });
  tables.sources[gh] = source('github', input.observations);
  tables.sources[t3] = source('t3', input.threads ?? {});
  tables.sources[local] = source('factory', {
    observedAt: input.observations.jobsObservedAt ?? Date.parse(at),
  });
  const observed = timestamp(input.observations.observedAt);
  const fact = <T>(value: T): Fact<T> => (observed ? known(value, gh, observed) : unknown(gh));
  const addUser = (u: ObservedUser) => {
    const id = `user:${u.id}` as const;
    tables.users[id] = entity({ ...u, id });
    return id;
  };
  const addLabel = (l: ObservedLabel) => {
    const id = `label:${l.id}` as const;
    tables.labels[id] = entity({ ...l, id, repositoryId });
    return id;
  };
  const ensureIssue = (n: number) => {
    const id = issueId(n);
    tables.issues[id] ??= entity({
      id,
      repositoryId,
      number: n,
      metadata: unknown(gh, 'Referenced issue metadata has not been collected.'),
      project: unknown(gh),
      eligibility: decision('unknown', 'Issue evidence is unavailable.'),
    });
    return id;
  };
  const facts = input.observations.facts;
  for (const i of facts?.issues ?? []) {
    const id = ensureIssue(i.number);
    const unobserved = !i.updatedAt || !i.labelDetails || !i.assigneeDetails;
    tables.issues[id] = entity({
      id,
      repositoryId,
      number: i.number,
      metadata: unobserved
        ? unknown(gh, 'Refresh rich GitHub metadata.')
        : fact({
            title: i.title,
            url: i.url,
            state: i.open ? ('open' as const) : ('closed' as const),
            updatedAt: i.updatedAt!,
            labelIds: i.labelDetails!.map(addLabel),
            assigneeIds: i.assigneeDetails!.map(addUser),
            commentCount: i.commentCount,
          }),
      project: i.projectDetails
        ? fact(i.projectDetails)
        : unknown(gh, 'Project field evidence unavailable.'),
      eligibility:
        !i.open || !i.candidate
          ? decision('blocked', 'An open ready-for-agent issue is required.')
          : input.state.admissions.some((a) => a.issue === i.number)
            ? decision('blocked', 'Issue already admitted.')
            : i.blockers.length
              ? decision('unknown', 'Prerequisites require current factory verification.')
              : decision('allowed', ''),
    });
    for (const parent of i.parents) {
      const parentId = ensureIssue(parent);
      const rid = `relationship:parent/${parent}/${i.number}` as const;
      tables.relationships[rid] = entity({
        id: rid,
        kind: 'parent',
        parentIssueId: parentId,
        childIssueId: id,
        evidence: fact(
          i.nativeParent === parent ? ('github-native' as const) : ('trusted-fallback' as const)
        ),
      });
    }
    for (const blocker of i.blockers) {
      const blockerId = ensureIssue(blocker);
      const rid = `relationship:prerequisite/${blocker}/${i.number}` as const;
      tables.relationships[rid] = entity({
        id: rid,
        kind: 'prerequisite',
        prerequisiteIssueId: blockerId,
        dependantIssueId: id,
        evidence: fact(
          i.nativeBlockers?.includes(blocker)
            ? ('github-native' as const)
            : ('trusted-fallback' as const)
        ),
        satisfaction: {
          state: 'unknown',
          reasons: [reason('unverified', 'Current-tree prerequisite verification is required.')],
        },
      });
    }
  }
  for (const p of facts?.pullRequests ?? []) {
    const id = pullId(p.number);
    const comparison = { headOid: p.head, baseOid: p.base, baseRef: p.baseBranch };
    const evidence = { headOid: p.evidenceHead, baseOid: null, baseRef: null };
    const readiness: Readiness = {
      state: 'unknown',
      reasons: [reason('unverified', 'Provider checks do not establish factory readiness.')],
      sourceIds: [local, gh],
    };
    tables.pullRequests[id] = entity({
      id,
      repositoryId,
      number: p.number,
      metadata:
        p.title !== undefined && p.draft !== undefined && p.updatedAt && p.labelDetails
          ? fact({
              title: p.title,
              url: p.url,
              state:
                p.state === 'OPEN'
                  ? ('open' as const)
                  : p.state === 'MERGED'
                    ? ('merged' as const)
                    : ('closed' as const),
              draft: p.draft,
              labelIds: p.labelDetails.map(addLabel),
              headRef: p.headBranch,
              baseRef: p.baseBranch,
              comparison,
              mergeability:
                p.mergeability === 'MERGEABLE'
                  ? ('clean' as const)
                  : p.mergeability === 'CONFLICTING'
                    ? ('conflicting' as const)
                    : p.mergeability === 'UNKNOWN'
                      ? ('pending' as const)
                      : ('unknown' as const),
              updatedAt: p.updatedAt,
            })
          : unknown(gh, 'Refresh rich PR metadata.'),
      checks: p.checkRuns
        ? fact({
            comparison: evidence,
            state:
              p.ci === 'SUCCESS'
                ? ('passed' as const)
                : p.ci === 'FAILURE'
                  ? ('failed' as const)
                  : p.ci === 'PENDING'
                    ? ('pending' as const)
                    : ('unknown' as const),
            complete: true,
            groups: p.checkRuns.map((c) => ({
              id: c.id,
              name: c.name,
              state: c.state,
              requirement: 'unknown' as const,
              total: 1,
              completed: ['passed', 'failed', 'skipped', 'neutral'].includes(c.state) ? 1 : 0,
              url: c.url,
            })),
          })
        : unknown(gh, 'Individual checks not observed.'),
      reviews: p.reviewers
        ? fact({
            comparison: evidence,
            state:
              p.review === 'APPROVED'
                ? ('approved' as const)
                : p.review === 'CHANGES_REQUESTED'
                  ? ('changes-requested' as const)
                  : p.review === 'REVIEW_REQUIRED'
                    ? ('required' as const)
                    : ('unknown' as const),
            complete: true,
            reviewers: p.reviewers.map((r) => ({
              userId: addUser(r.user),
              state: r.state,
              submittedAt: r.submittedAt,
              reviewedHeadOid: r.head,
            })),
          })
        : unknown(gh, 'Reviewers not observed.'),
      readiness,
    });
    for (const n of [...p.linkedIssues, ...p.crossReferencedIssues]) {
      const iid = ensureIssue(n);
      const rid = `relationship:issue-pr/${n}/${p.number}` as const;
      const closing = p.linkedIssues.includes(n);
      tables.relationships[rid] = entity({
        id: rid,
        kind: 'issue-pr',
        issueId: iid,
        pullRequestId: id,
        evidence: fact(closing ? ('closing-reference' as const) : ('cross-reference' as const)),
        ownership: closing ? ('confirmed' as const) : ('context-only' as const),
      });
    }
  }
  // Associations use explicit provider/factory evidence. T3 status never grants execution authority.
  const threadFacts = input.threads?.facts,
    threadAt = timestamp(input.threads?.observedAt);
  for (const t of threadFacts?.threads ?? []) {
    const id = threadId(threadFacts!.environmentId, t.threadId);
    const issues = [...new Set((t.associations ?? []).map((a) => ensureIssue(a.issue)))];
    const pulls = t.pullRequests
      .filter((p) => p.repository === 'rafaeltab/wallpaperdb')
      .map((p) => pullId(p.number))
      .filter((p) => tables.pullRequests[p]);
    const path = `${encodeURIComponent(threadFacts!.environmentId)}/${encodeURIComponent(t.threadId)}`;
    tables.threads[id] = entity({
      id,
      metadata: threadAt
        ? known(
            {
              title: t.title,
              createdAt: t.createdAt,
              updatedAt: t.updatedAt,
              status: t.status,
              environmentId: threadFacts!.environmentId,
              threadId: t.threadId,
              webUrl: input.threads?.browserOrigin
                ? `${input.threads.browserOrigin}/${path}`
                : null,
              nativeUrl: `t3code://threads/${path}`,
            },
            t3,
            threadAt
          )
        : unknown(t3),
      association:
        t.associationState === 'evidenced'
          ? {
              state: 'confirmed' as const,
              issueIds: issues,
              pullRequestIds: pulls,
              evidence: (t.associations ?? []).some((a) => a.evidence === 'factory-binding')
                ? ('factory-binding' as const)
                : ('closing-reference' as const),
            }
          : {
              state:
                t.associationState === 'conflicting'
                  ? ('ambiguous' as const)
                  : t.associationState === 'absent'
                    ? ('absent' as const)
                    : ('unknown' as const),
              reasons: [],
            },
    });
  }
  const jobForIssue = new Map<number, import('../job/index.js').Status>();
  for (const admission of input.state.admissions) {
    const status = input.jobs.find((j) => j.kind === 'job' && j.intent.issue === admission.issue);
    if (status) jobForIssue.set(admission.issue, status);
    const work = input.localWork.find((w) => w.intent?.issue === admission.issue),
      control = work?.control;
    const current = status?.kind === 'job' ? status : undefined;
    const delivery = current?.delivery;
    const iid = ensureIssue(admission.issue),
      id = jobId(admission.issue);
    const boundPr = delivery?.pr?.kind === 'found' ? delivery.pr : current?.prerequisite;
    const prNumber = boundPr ? Number(boundPr.url.split('/').at(-1)) : undefined;
    const pid = prNumber && tables.pullRequests[pullId(prNumber)] ? pullId(prNumber) : null;
    if (pid) {
      const rid = `relationship:binding/${admission.issue}/${prNumber}` as const;
      tables.relationships[rid] = entity({
        id: rid,
        kind: 'issue-pr',
        issueId: iid,
        pullRequestId: pid,
        evidence: known('factory-binding' as const, local, at),
        ownership: 'confirmed' as const,
      });
      const pr = tables.pullRequests[pid];
      const verified = current?.prerequisite;
      if (
        verified?.parent &&
        verified.base &&
        pr.metadata.state === 'known' &&
        verified.commit === pr.metadata.value.comparison.headOid &&
        verified.parent === pr.metadata.value.comparison.baseOid &&
        verified.base === pr.metadata.value.comparison.baseRef
      )
        tables.pullRequests[pid] = entity({
          ...pr,
          readiness: {
            state: delivery?.landed ? ('landed' as const) : ('ready' as const),
            comparison: pr.metadata.value.comparison,
            verifiedAt: timestamp(input.observations.jobsObservedAt) ?? at,
            sourceIds: [local, gh],
          },
        });
    }
    const execution = current?.execution;
    const tid =
      execution?.kind === 'found' && threadFacts
        ? threadId(threadFacts.environmentId, execution.threadId)
        : null;
    const safeTid = tid && tables.threads[tid] ? tid : null;
    const resuming = (input.state.resuming ?? []).some((r) => r.issue === admission.issue);
    tables.jobs[id] = entity({
      id,
      issueId: iid,
      pullRequestId: pid,
      threadId: safeTid,
      startedAt: timestamp(current?.intent.createdAt),
      stage: delivery?.stage ?? 'unknown',
      activity: control?.cancelled
        ? 'cancelled'
        : (delivery?.activity ?? delivery?.stage ?? 'unknown'),
      activityStartedAt: null,
      deadline: timestamp(delivery?.deadline),
      progress: '',
      execution:
        execution?.kind === 'found'
          ? known(
              {
                runId: execution.run?.id ?? null,
                state:
                  execution.status === 'running'
                    ? ('running' as const)
                    : execution.status === 'waiting'
                      ? ('waiting' as const)
                      : execution.status === 'completed'
                        ? ('finished' as const)
                        : ('unknown' as const),
              },
              local,
              timestamp(input.observations.jobsObservedAt) ?? at
            )
          : unknown(local, 'Owning execution not observed. Do not relaunch.'),
      occupiesCapacity: holdsSlot(status ?? { kind: 'empty' }, resuming),
      cancelled: control?.cancelled ?? false,
      question: control?.parked
        ? { id: control.parked.question.id, summary: control.parked.question.text.slice(0, 200) }
        : delivery?.question
          ? { id: delivery.question.id, summary: delivery.question.text.slice(0, 200) }
          : null,
    });
  }
  for (const recovery of input.recoveries ?? []) {
    const pr = Object.values(tables.pullRequests).find(
      (p) => p.metadata.state === 'known' && p.metadata.value.url === recovery.pr
    );
    if (!pr) continue;
    const id = `maintenance:${recovery.issue}/${pr.number}` as const;
    const tid =
      threadFacts && recovery.threadId
        ? threadId(threadFacts.environmentId, recovery.threadId)
        : null;
    tables.maintenance[id] = entity({
      id,
      issueId: ensureIssue(recovery.issue),
      pullRequestId: pr.id,
      threadId: tid && tables.threads[tid] ? tid : null,
      phase: recovery.active === false ? ('manual-recovery' as const) : ('unknown' as const),
      resolution:
        recovery.classification === 'SIMPLE'
          ? ('simple' as const)
          : recovery.classification === 'COMPLEX'
            ? ('complex' as const)
            : ('unknown' as const),
      progress: recovery.progress,
      startedAt: null,
      occupiesCapacity: recovery.active !== false,
    });
  }
  function card(
    subject: WorkItem['subject'],
    section: WorkItem['section'],
    jobs: import('./model.js').Job[]
  ) {
    const pid = subject.kind === 'pull-request' ? subject.pullRequestId : null;
    const maintenance = Object.values(tables.maintenance).filter((m) => m.pullRequestId === pid);
    const pr = pid ? tables.pullRequests[pid] : undefined;
    const code: WorkItem['status']['code'] = jobs.some((j) => j.cancelled)
      ? 'cancelled'
      : maintenance.some((m) => m.phase === 'manual-recovery')
        ? 'manual-recovery'
        : jobs.some((j) => j.question)
          ? 'awaiting-answer'
          : jobs.some((j) => j.activity === 'manual-recovery')
            ? 'manual-recovery'
            : maintenance.length
              ? 'restacking'
              : jobs.some(
                    (j) => j.activity === 'continuation-pending' || j.activity === 'resume-pending'
                  )
                ? 'continuation-pending'
                : jobs.some((j) => j.execution.state === 'unknown')
                  ? 'launching'
                  : jobs.some((j) => j.activity === 'repairing')
                    ? 'repairing-ci'
                    : jobs.length
                      ? jobs[0].stage === 'implementation'
                        ? 'implementing'
                        : jobs[0].stage === 'review'
                          ? 'reviewing-code'
                          : jobs[0].stage === 'publication'
                            ? 'publishing'
                            : jobs[0].stage === 'ci'
                              ? 'ci-running'
                              : jobs[0].stage === 'babysitting'
                                ? 'babysitting'
                                : 'unknown'
                      : pr?.reviews.state === 'known' && pr.reviews.value.state === 'required'
                        ? 'needs-review'
                        : pr?.metadata.state === 'known' &&
                            pr.metadata.value.mergeability === 'conflicting'
                          ? 'conflict'
                          : pr?.checks.state === 'known' && pr.checks.value.state === 'failed'
                            ? 'ci-failed'
                            : pr?.checks.state === 'known' && pr.checks.value.state === 'pending'
                              ? 'ci-running'
                              : subject.kind === 'issue'
                                ? tables.issues[subject.issueId].eligibility.state === 'allowed'
                                  ? 'ready'
                                  : 'blocked'
                                : 'unknown';
    const attention: WorkItem['attention'] =
      code === 'manual-recovery'
        ? {
            state: 'required',
            sourceIds: [local],
            reasons: [
              {
                code: 'manual-recovery',
                message: 'Operator reconciliation is required.',
                actionIds: [],
              },
            ],
          }
        : code === 'awaiting-answer'
          ? {
              state: 'required',
              sourceIds: [local],
              reasons: [
                {
                  code: 'awaiting-answer',
                  message: 'Answer in the owning T3 thread.',
                  actionIds: [],
                },
              ],
            }
          : code === 'needs-review'
            ? {
                state: 'required',
                sourceIds: [gh],
                reasons: [
                  { code: 'needs-review', message: 'Human review is required.', actionIds: [] },
                ],
              }
            : code === 'unknown' || code === 'conflict' || code === 'launching'
              ? {
                  state: 'unknown',
                  sourceIds: [local, gh],
                  reasons: [reason('unknown-authority', 'The next actor cannot be established.')],
                }
              : { state: 'none', sourceIds: [local, gh] };
    const id = `item:${pid ?? (subject.kind === 'issue' ? subject.issueId : 'unknown')}` as const;
    const tids = [
      ...new Set([
        ...jobs.flatMap((j) => (j.threadId ? [j.threadId] : [])),
        ...maintenance.flatMap((m) => (m.threadId ? [m.threadId] : [])),
        ...Object.values(tables.threads)
          .filter(
            (t) =>
              t.association.state === 'confirmed' &&
              (pid
                ? t.association.pullRequestIds.includes(pid)
                : subject.kind === 'issue' && t.association.issueIds.includes(subject.issueId))
          )
          .map((t) => t.id),
      ]),
    ];
    const item = entity({
      id,
      subject,
      section,
      status: {
        code,
        label: code.replaceAll('-', ' '),
        active: jobs.some((j) => j.occupiesCapacity) || maintenance.some((m) => m.occupiesCapacity),
        since: null,
      },
      attention,
      jobIds: jobs.map((j) => j.id),
      maintenanceIds: maintenance.map((m) => m.id),
      threadIds: tids,
      actionIds: [],
    });
    tables.items[id] = item;
    const p = pid ? (facts?.pullRequests ?? []).find((p) => pullId(p.number) === pid) : undefined;
    details[id] = {
      apiVersion: 2,
      itemId: id,
      itemVersion: item.version,
      observedAt: at,
      questions: jobs.flatMap((j) => {
        const w = input.localWork.find((w) => w.intent && issueId(w.intent.issue) === j.issueId);
        return w?.control.parked ? [{ jobId: j.id, ...w.control.parked.question }] : [];
      }),
      checkRuns: p?.checkRuns
        ? fact(
            p.checkRuns.map((c) => ({
              id: c.id,
              groupId: c.id,
              name: c.name,
              url: c.url,
              comparison: { headOid: c.head, baseOid: null, baseRef: null },
              state: c.state,
              startedAt: c.startedAt,
              completedAt: c.completedAt,
            }))
          )
        : unknown(gh, 'Check runs not observed.'),
    };
  }
  for (const pr of Object.values(tables.pullRequests)) {
    const jobs = Object.values(tables.jobs).filter((j) => j.pullRequestId === pr.id);
    const raw = facts?.pullRequests.find((p) => p.number === pr.number);
    if (
      raw?.state !== 'OPEN' &&
      !jobs.some((j) => j.occupiesCapacity) &&
      !Object.values(tables.maintenance).some((m) => m.pullRequestId === pr.id)
    )
      continue;
    const associated = [
      ...new Set(
        Object.values(tables.relationships).flatMap((r) =>
          r.kind === 'issue-pr' && r.pullRequestId === pr.id && r.ownership === 'confirmed'
            ? [r.issueId]
            : []
        )
      ),
    ];
    card(
      {
        kind: 'pull-request',
        pullRequestId: pr.id,
        issueIds: associated,
        metadataIssueId: associated.length === 1 ? associated[0] : null,
      },
      'in-review',
      jobs
    );
  }
  for (const i of Object.values(tables.issues)) {
    const jobs = Object.values(tables.jobs).filter((j) => j.issueId === i.id && !j.pullRequestId);
    const linked = Object.values(tables.items).some(
      (c) => c.subject.kind === 'pull-request' && c.subject.issueIds.includes(i.id)
    );
    if (linked) continue;
    if (jobs.some((j) => !j.cancelled)) card({ kind: 'issue', issueId: i.id }, 'working', jobs);
    else if (
      facts?.issues.some((raw) => raw.number === i.number && raw.candidate && raw.open) &&
      !input.state.admissions.some((a) => a.issue === i.number)
    )
      card({ kind: 'issue', issueId: i.id }, 'planned', []);
  }
  const unresolved = Object.values(tables.issues)
    .filter((i) => i.metadata.state === 'unknown')
    .map((i) => i.id);
  const coverage = {
    state: !facts
      ? ('unavailable' as const)
      : unresolved.length
        ? ('partial' as const)
        : ('complete' as const),
    reasons: !facts
      ? [reason('initial', 'Provider facts have not been observed.')]
      : unresolved.length
        ? [reason('missing-context', 'Some referenced issues have not been observed.')]
        : [],
    unresolvedIssueIds: unresolved,
  };
  const factory = entity({
    id: 'factory:local' as const,
    paused: input.state.paused,
    concurrency: { limit: limit(input.state.concurrency), occupied: capacityOccupied(input) },
    admission: { limit: limit(input.state.allowance), consumed: input.state.admissions.length },
    actionIds: [],
  });
  const snapshot: FactoryV2Snapshot = {
    apiVersion: 2,
    scopeId,
    cursor,
    committedAt: at,
    meta: {
      dataMode: 'live',
      coverage,
      diagnostics: [],
      factory,
      currentPlanId: null,
      transport: { changes: true, events: true, suggestedPollMs: 1000 },
    },
    entities: tables,
  };
  return { snapshot, details };
}
