import type { ScheduleSnapshot } from '../observe/index.js';
import type { Action, ActionKind, FactoryV2Snapshot } from './model.js';
import { entity, jobId, version } from './values.js';
export function actions(snapshot: FactoryV2Snapshot, input: ScheduleSnapshot): FactoryV2Snapshot {
  const result: Record<Action['id'], Action> = {};
  const make = (
    kind: ActionKind,
    targetId: Action['targetId'],
    available: boolean,
    message: string,
    basis: unknown
  ) => {
    const id = `action:${kind}/${targetId}` as const;
    result[id] = entity({
      id,
      kind,
      targetId,
      availability: available
        ? {
            state: 'available' as const,
            precondition: version({ scope: snapshot.scopeId, kind, targetId, basis }),
            validUntil: null,
          }
        : { state: 'disabled' as const, reasons: [{ code: 'unavailable', message }] },
    });
    return id;
  };
  const factory = snapshot.meta.factory;
  const configure = make('configure', factory.id, true, '', input.state.revision);
  const currentPlan = snapshot.meta.currentPlanId
    ? snapshot.entities.plans[snapshot.meta.currentPlanId]
    : undefined;
  const preview = make(
    'preview-plan',
    factory.id,
    !currentPlan || currentPlan.phase === 'succeeded' || currentPlan.phase === 'failed',
    'A planning attempt is outstanding.',
    input.state.revision
  );
  const capacity =
    !factory.paused &&
    (factory.concurrency.limit.kind === 'unlimited' ||
      factory.concurrency.occupied < factory.concurrency.limit.maximum) &&
    (factory.admission.limit.kind === 'unlimited' ||
      factory.admission.consumed < factory.admission.limit.maximum);
  for (const i of Object.values(snapshot.entities.issues))
    make(
      'start',
      i.id,
      capacity && i.eligibility.state === 'allowed',
      'Issue eligibility, capacity, pause or admission allowance prevents start.',
      { revision: input.state.revision, eligibility: i.eligibility, version: i.version }
    );
  for (const admission of input.state.admissions) {
    const current = input.jobs.find((j) => j.kind === 'job' && j.intent.issue === admission.issue);
    const work = input.localWork.find((w) => w.intent?.issue === admission.issue);
    const id = jobId(admission.issue);
    const cancelled = work?.control.cancelled;
    make(
      'cancel',
      id,
      current?.kind === 'job' && !cancelled,
      'No observed cancellable owning job.',
      { job: work?.intent?.id, control: work?.control.revision }
    );
    make(
      'resume',
      id,
      current?.kind === 'job' && !!current.resume && !cancelled,
      'No current continuation is available.',
      {
        job: work?.intent?.id,
        control: work?.control.revision,
        resume: current?.kind === 'job' ? current.resume : null,
      }
    );
  }
  const items = Object.fromEntries(
    Object.values(snapshot.entities.items).map((item) => {
      const targets = [
        ...(item.subject.kind === 'issue' ? [item.subject.issueId] : []),
        ...item.jobIds,
      ];
      const actionIds = Object.values(result)
        .filter((a) => targets.some((t) => t === a.targetId))
        .map((a) => a.id);
      const pr =
        item.subject.kind === 'pull-request'
          ? snapshot.entities.pullRequests[item.subject.pullRequestId]
          : undefined;
      const questions = input.localWork
        .filter((w) => w.intent && item.jobIds.includes(jobId(w.intent.issue)))
        .map((w) => w.control.parked?.question);
      return [
        item.id,
        {
          ...item,
          actionIds,
          version: version({ base: item.version, pr: pr?.version, questions, actionIds }),
        },
      ];
    })
  );
  return {
    ...snapshot,
    meta: { ...snapshot.meta, factory: entity({ ...factory, actionIds: [configure, preview] }) },
    entities: { ...snapshot.entities, actions: result, items },
  };
}
