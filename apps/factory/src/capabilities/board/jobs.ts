import { holdsSlot } from '../plan/index.js';
import { type ProjectionContext, gh, local } from './context.js';
import { entity, jobId, known, pullId, threadId, timestamp, unknown } from './values.js';
export function populateJobs(context: ProjectionContext) {
  const { tables, input, at, ensureIssue } = context;
  const threadFacts = input.threads?.facts;
  for (const admission of input.state.admissions) {
    const status = input.jobs.find((j) => j.kind === 'job' && j.intent.issue === admission.issue);
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
}
