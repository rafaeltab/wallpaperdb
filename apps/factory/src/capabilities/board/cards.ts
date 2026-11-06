import { type ProjectionContext, gh } from './context.js';
import type { WorkItem } from './model.js';
import { attention, factoryStatus, providerStatus } from './status.js';
import { entity, issueId, pullId, unknown } from './values.js';
export function populateCards(context: ProjectionContext) {
  const { tables, details, input, at, fact, facts } = context;
  function card(
    subject: WorkItem['subject'],
    section: WorkItem['section'],
    jobs: import('./model.js').Job[]
  ) {
    const pid = subject.kind === 'pull-request' ? subject.pullRequestId : null;
    const maintenance = Object.values(tables.maintenance).filter((m) => m.pullRequestId === pid);
    const pr = pid ? tables.pullRequests[pid] : undefined;
    const recoveryQuestion =
      !!pr &&
      input.recoveries?.some(
        (r) => r.question && pr.metadata.state === 'known' && r.pr === pr.metadata.value.url
      );
    const automatic = factoryStatus(jobs, maintenance, !!recoveryQuestion),
      provider = providerStatus(pr);
    const terminal =
      (provider === 'ready' || provider === 'landed') &&
      jobs.every((j) => !j.occupiesCapacity) &&
      maintenance.length === 0 &&
      automatic !== 'manual-recovery' &&
      automatic !== 'awaiting-answer' &&
      automatic !== 'cancelled';
    const code = terminal
      ? provider
      : (automatic ??
        provider ??
        (subject.kind === 'issue'
          ? tables.issues[subject.issueId].eligibility.state === 'allowed'
            ? 'ready'
            : 'blocked'
          : 'unknown'));
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
      attention: attention(code),
      jobIds: jobs.map((j) => j.id),
      maintenanceIds: maintenance.map((m) => m.id),
      threadIds: tids,
      actionIds: [],
    });
    tables.items[id] = item;
    const p = pid ? (facts?.pullRequests ?? []).find((p) => pullId(p.number) === pid) : undefined;
    details[id] = {
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
      !jobs.some(
        (j) =>
          j.occupiesCapacity || (!j.cancelled && !!j.question) || j.activity === 'manual-recovery'
      ) &&
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
    if (linked && jobs.length === 0) continue;
    if (jobs.some((j) => !j.cancelled)) card({ kind: 'issue', issueId: i.id }, 'working', jobs);
    else if (
      facts?.issues.some((raw) => raw.number === i.number && raw.candidate && raw.open) &&
      !input.state.admissions.some((a) => a.issue === i.number)
    )
      card({ kind: 'issue', issueId: i.id }, 'planned', []);
  }
}
