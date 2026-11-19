import { holdsSlot } from '../plan/index.js';
import type { Control, Status } from '../job/index.js';
import { type ProjectionContext, gh, local, t3 } from './context.js';
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
    const question = currentQuestion(current, control);
    const observation = current
      ? input.observations.items?.[`job:${current.intent.id}`]
      : undefined;
    const observedAt =
      timestamp(observation?.observedAt) ?? timestamp(input.observations.jobsObservedAt) ?? at;
    const iid = ensureIssue(admission.issue),
      id = jobId(admission.issue);
    const boundPr = delivery?.pr?.kind === 'found' ? delivery.pr : current?.prerequisite;
    const prUrl = boundPr?.url ?? control?.ownership?.prUrl ?? control?.prerequisite?.url;
    const prNumber = prUrl ? Number(prUrl.split('/').at(-1)) : undefined;
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
      const verified = delivery?.pr?.kind === 'found' ? delivery.pr : current?.prerequisite;
      if (
        (delivery?.ready || delivery?.landed) &&
        verified &&
        pr.metadata.state === 'known' &&
        verified.commit === pr.metadata.value.comparison.headOid &&
        (!verified.base || verified.base === pr.metadata.value.comparison.baseRef)
      )
        tables.pullRequests[pid] = entity({
          ...pr,
          readiness: {
            state: delivery?.landed ? ('landed' as const) : ('ready' as const),
            comparison: pr.metadata.value.comparison,
            verifiedAt: observedAt,
            sourceIds: [local, gh],
          },
        });
    }
    const execution = current?.execution;
    const observationFailed =
      observation?.failedAt !== undefined && observation.failedAt >= (observation.observedAt ?? 0);
    const unavailable =
      (observationFailed ||
        execution?.kind === 'unverified' ||
        (execution?.kind !== 'found' && !!control?.ownership)) &&
      !(
        (execution?.kind === 'found' || execution?.kind === 'unverified') &&
        ['completed', 'idle', 'failed', 'interrupted', 'cancelled', 'rolled_back'].includes(
          execution.status
        )
      );
    const owner =
      execution?.kind === 'found' || execution?.kind === 'unverified'
        ? execution.threadId
        : control?.ownership?.threadId;
    const tid = owner && threadFacts ? threadId(threadFacts.environmentId, owner) : null;
    if (tid) {
      const prior = tables.threads[tid];
      tables.threads[tid] = entity({
        id: tid,
        metadata: prior?.metadata ?? unknown(t3, 'Owning thread metadata unavailable.'),
        association: {
          state: 'confirmed' as const,
          issueIds: [iid],
          pullRequestIds: pid ? [pid] : [],
          evidence: 'factory-binding' as const,
        },
      });
    }
    const safeTid = tid && tables.threads[tid] ? tid : null;
    const resuming = (input.state.resuming ?? []).some((r) => r.issue === admission.issue);
    tables.jobs[id] = entity({
      id,
      observation,
      issueId: iid,
      pullRequestId: pid,
      threadId: safeTid,
      observedModel: current?.execution.kind === 'found' ? current.execution.model : undefined,
      executionSettings: current?.intent.execution ?? admission.execution,
      observedExecution:
        current?.execution.kind === 'found' ? current.execution.observedExecution : undefined,
      lastAcceptedDelivery: current?.acknowledgement,
      startedAt: timestamp(current?.intent.createdAt),
      stage: delivery?.stage ?? 'unknown',
      activity: control?.cancelled
        ? 'cancelled'
        : unavailable
          ? 'observation-unavailable'
          : execution?.kind === 'found' &&
              execution.manual &&
              (!delivery?.activity ||
                ['repairing', 'waiting-for-github'].includes(delivery.activity))
            ? 'manual-continuation'
            : (delivery?.activity ?? delivery?.stage ?? 'unknown'),
      activityStartedAt: null,
      deadline: timestamp(delivery?.deadline),
      progress: delivery?.progress ?? '',
      execution:
        (execution?.kind === 'found' || execution?.kind === 'unverified') && !unavailable
          ? known(
              {
                runId: execution.run?.id ?? null,
                state: ['running', 'preparing', 'queued', 'starting'].includes(execution.status)
                  ? ('running' as const)
                  : execution.status === 'waiting'
                    ? ('waiting' as const)
                    : ['completed', 'idle'].includes(execution.status)
                      ? ('finished' as const)
                      : ['interrupted', 'failed', 'cancelled', 'rolled_back'].includes(
                            execution.status
                          )
                        ? ('interrupted' as const)
                        : ('unknown' as const),
              },
              local,
              observedAt
            )
          : unknown(local, 'Owning execution not observed. Do not relaunch.'),
      occupiesCapacity: holdsSlot(status ?? { kind: 'empty' }, resuming),
      cancelled: control?.cancelled ?? false,
      question: question ? { id: question.id, summary: question.text.slice(0, 200) } : null,
    });
  }
}

export function currentQuestion(
  current: Extract<Status, { kind: 'job' }> | undefined,
  control: Control | undefined
) {
  if (current?.delivery?.landed) return undefined;
  const index = current?.stageIndex ?? current?.resume?.index;
  const parked = control?.parked;
  return (
    current?.delivery?.question ??
    (parked && (index === undefined || parked.index === index) ? parked.question : undefined)
  );
}
