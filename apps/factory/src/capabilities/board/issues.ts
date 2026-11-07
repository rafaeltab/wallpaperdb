import { type ProjectionContext, gh, repositoryId } from './context.js';
import { issueEligibility, relationshipEvidence, satisfaction } from './eligibility.js';
import { entity, unknown } from './values.js';
export function populateIssues(context: ProjectionContext) {
  const { tables, input, observed, fact, addUser, addLabel, ensureIssue, facts } = context;
  for (const i of facts?.issues ?? []) {
    const id = ensureIssue(i.number);
    const { updatedAt, labelDetails, assigneeDetails } = i;
    tables.issues[id] = entity({
      id,
      repositoryId,
      number: i.number,
      metadata:
        updatedAt && labelDetails && assigneeDetails
          ? fact({
              title: i.title,
              url: i.url,
              state: i.open ? ('open' as const) : ('closed' as const),
              updatedAt,
              labelIds: labelDetails.map(addLabel),
              assigneeIds: assigneeDetails.map(addUser),
              commentCount: i.commentCount,
            })
          : unknown(gh, 'Rich GitHub metadata has not been observed.'),
      project: i.projectDetails
        ? fact(i.projectDetails)
        : unknown(gh, 'Project field evidence unavailable.'),
      eligibility: issueEligibility(i, input.state),
    });
    for (const parent of i.parents) {
      const parentId = ensureIssue(parent);
      const rid = `relationship:parent/${parent}/${i.number}` as const;
      tables.relationships[rid] = entity({
        id: rid,
        kind: 'parent',
        parentIssueId: parentId,
        childIssueId: id,
        evidence: relationshipEvidence(i.nativeParent === parent, i, observed),
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
        evidence: relationshipEvidence(i.nativeBlockers?.includes(blocker) ?? false, i, observed),
        satisfaction: facts ? satisfaction(i, blocker, facts) : { state: 'unknown', reasons: [] },
      });
    }
  }
}
