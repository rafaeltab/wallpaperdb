import type { FactoryV2Snapshot, Fact, Readiness, Relationship } from './model.js';
import { entity, version } from './values.js';
export function retainFact<T>(before: Fact<T> | undefined, after: Fact<T>): Fact<T> {
  return before?.state === 'known' &&
    after.state === 'known' &&
    before.sourceId === after.sourceId &&
    version(before.value) === version(after.value)
    ? before
    : after;
}
function readiness(before: Readiness | undefined, after: Readiness): Readiness {
  return before &&
    (before.state === 'ready' || before.state === 'landed') &&
    (after.state === 'ready' || after.state === 'landed') &&
    before.state === after.state &&
    version(before.comparison) === version(after.comparison)
    ? before
    : after;
}
/** Reconfirmation updates shared sources. Facts retain their last changed payload. */
export function retainFacts(
  before: FactoryV2Snapshot,
  after: FactoryV2Snapshot
): FactoryV2Snapshot {
  const prior = before.entities,
    next = after.entities;
  return {
    ...after,
    entities: {
      ...next,
      issues: Object.fromEntries(
        Object.values(next.issues).map((i) => [
          i.id,
          entity({
            ...i,
            metadata: retainFact(prior.issues[i.id]?.metadata, i.metadata),
            project: retainFact(prior.issues[i.id]?.project, i.project),
          }),
        ])
      ),
      pullRequests: Object.fromEntries(
        Object.values(next.pullRequests).map((p) => [
          p.id,
          entity({
            ...p,
            metadata: retainFact(prior.pullRequests[p.id]?.metadata, p.metadata),
            checks: retainFact(prior.pullRequests[p.id]?.checks, p.checks),
            reviews: retainFact(prior.pullRequests[p.id]?.reviews, p.reviews),
            readiness: readiness(prior.pullRequests[p.id]?.readiness, p.readiness),
          }),
        ])
      ),
      threads: Object.fromEntries(
        Object.values(next.threads).map((t) => [
          t.id,
          entity({ ...t, metadata: retainFact(prior.threads[t.id]?.metadata, t.metadata) }),
        ])
      ),
      jobs: Object.fromEntries(
        Object.values(next.jobs).map((j) => [
          j.id,
          entity({ ...j, execution: retainFact(prior.jobs[j.id]?.execution, j.execution) }),
        ])
      ),
      relationships: Object.fromEntries(
        Object.values(next.relationships).map((r) => [
          r.id,
          retainRelationship(prior.relationships[r.id], r),
        ])
      ),
      stacks: Object.fromEntries(
        Object.values(next.stacks).map((s) => [
          s.id,
          entity({ ...s, evidence: retainFact(prior.stacks[s.id]?.evidence, s.evidence) }),
        ])
      ),
    },
  };
}

function retainRelationship(before: Relationship | undefined, after: Relationship): Relationship {
  switch (after.kind) {
    case 'parent':
      return entity({
        ...after,
        evidence: retainFact(
          before?.kind === 'parent' ? before.evidence : undefined,
          after.evidence
        ),
      });
    case 'prerequisite':
      return entity({
        ...after,
        evidence: retainFact(
          before?.kind === 'prerequisite' ? before.evidence : undefined,
          after.evidence
        ),
      });
    case 'issue-pr':
      return entity({
        ...after,
        evidence: retainFact(
          before?.kind === 'issue-pr' ? before.evidence : undefined,
          after.evidence
        ),
      });
    case 'pr-base':
      return entity({
        ...after,
        evidence: retainFact(
          before?.kind === 'pr-base' ? before.evidence : undefined,
          after.evidence
        ),
      });
  }
}
