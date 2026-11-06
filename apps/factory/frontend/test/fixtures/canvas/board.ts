import type { FactoryV2Snapshot, WorkItem } from '../../../../src/http/index.js';
type Tables = FactoryV2Snapshot['entities'];
type IssueId = keyof Tables['issues'];
type PullRequestId = keyof Tables['pullRequests'];
type Relationship = Tables['relationships'][keyof Tables['relationships']];
type Stack = Tables['stacks'][keyof Tables['stacks']];
type Label = Tables['labels'][keyof Tables['labels']];
import type { FixtureBundle } from './factory-scale-fixture';

/** Test-only translation of the archived visual scenarios to the public v2 wire shape. */
export function scenarioBoard(seed: FactoryV2Snapshot, fixture: FixtureBundle): FactoryV2Snapshot {
  const issueTemplate = seed.entities.issues['issue:1001'],
    prTemplate = seed.entities.pullRequests['pr:2003'];
  if (
    issueTemplate.metadata.state !== 'known' ||
    issueTemplate.project.state !== 'known' ||
    prTemplate.metadata.state !== 'known'
  )
    throw new Error('Expected known seed metadata');
  const observedAt = issueTemplate.metadata.observedAt;
  const issues: Record<IssueId, typeof issueTemplate> = {},
    pullRequests: Record<PullRequestId, typeof prTemplate> = {},
    items: Record<WorkItem['id'], WorkItem> = {},
    relationships: Record<Relationship['id'], Relationship> = {},
    stacks: Record<Stack['id'], Stack> = {},
    labels: Record<Label['id'], Label> = {};
  const issueId = (n: number): IssueId => `issue:visual-${n}`;
  const pullId = (n: number): PullRequestId => `pr:visual-${n}`;
  for (const meta of Object.values(fixture.metadata)) {
    const labelIds = meta.labels.map((l) => {
      const id: Label['id'] = `label:${l.name}`;
      labels[id] = {
        id,
        version: '1',
        repositoryId: issueTemplate.repositoryId,
        name: l.name,
        color: l.color,
      };
      return id;
    });
    const id = issueId(meta.number);
    issues[id] = {
      ...issueTemplate,
      id,
      number: meta.number,
      metadata: {
        ...issueTemplate.metadata,
        value: { ...issueTemplate.metadata.value, title: meta.title, url: meta.url, labelIds },
      },
      project: {
        ...issueTemplate.project,
        value: {
          ...issueTemplate.project.value,
          priority: meta.priority
            ? {
                id: meta.priority,
                name: meta.priority,
                rank: ['P0', 'P1', 'P2', 'P3', 'P4'].indexOf(meta.priority),
              }
            : null,
          size: meta.size
            ? {
                id: meta.size,
                name: meta.size,
                rank: ['XS', 'S', 'M', 'L', 'XL'].indexOf(meta.size),
              }
            : null,
        },
      },
    };
  }
  const parent = (child: number, ancestor: number) => {
    const id: Relationship['id'] = `relationship:parent-${child}`;
    relationships[id] = {
      id,
      version: '1',
      kind: 'parent',
      childIssueId: issueId(child),
      parentIssueId: issueId(ancestor),
      evidence: {
        state: 'known',
        value: 'github-native',
        sourceId: issueTemplate.metadata.sourceId,
        observedAt,
      },
    };
  };
  for (const [child, ancestor] of Object.entries(fixture.parentOf)) parent(Number(child), ancestor);
  for (const item of fixture.items) {
    const id: WorkItem['id'] = `item:visual-${item.id}`;
    if (item.parent) parent(item.id, item.parent);
    items[id] = {
      id,
      version: '1',
      subject: item.pr
        ? {
            kind: 'pull-request',
            pullRequestId: pullId(item.pr),
            issueIds: [issueId(item.id)],
            metadataIssueId: issueId(item.id),
          }
        : { kind: 'issue', issueId: issueId(item.id) },
      section: item.stage === 'review' ? 'in-review' : item.stage,
      status: {
        code: 'unknown',
        label: item.status,
        active: [
          'Implementing',
          'Reviewing code',
          'Restacking',
          'Babysitting',
          'Repairing CI',
          'CI running',
        ].includes(item.status),
        since: null,
      },
      attention: { state: 'none', sourceIds: [] },
      jobIds: [],
      maintenanceIds: [],
      threadIds:
        item.thread || (item.synthetic && item.stage !== 'planned')
          ? [Object.values(seed.entities.threads)[0].id]
          : [],
      actionIds: [],
    };
    if (item.pr) {
      const issue = issues[issueId(item.id)];
      if (issue.metadata.state !== 'known') throw new Error('Expected scenario metadata');
      const prId = pullId(item.pr);
      pullRequests[prId] = {
        ...prTemplate,
        id: prId,
        number: item.pr,
        metadata: {
          ...prTemplate.metadata,
          value: {
            ...prTemplate.metadata.value,
            title: issue.metadata.value.title,
            draft: !!item.draft,
            labelIds: issue.metadata.value.labelIds,
          },
        },
      };
    }
    item.deps.forEach((dep) => {
      const key: Relationship['id'] = `relationship:dep-${item.id}-${dep}`;
      relationships[key] = {
        id: key,
        version: '1',
        kind: 'prerequisite',
        prerequisiteIssueId: issueId(dep),
        dependantIssueId: issueId(item.id),
        evidence: {
          state: 'known',
          value: 'github-native',
          sourceId: issueTemplate.metadata.sourceId,
          observedAt,
        },
        satisfaction: { state: 'unsatisfied', reasons: [] },
      };
    });
  }
  for (const spec of fixture.stackSpecs.filter((s) => s.stacked)) {
    const id: Stack['id'] = `stack:${spec.key}`;
    stacks[id] = {
      id,
      version: '1',
      pullRequestIdsBaseToTip: spec.ids.flatMap((n) => {
        const item = fixture.items.find((i) => i.id === n);
        return item?.pr ? [pullId(item.pr)] : [];
      }),
      base: { ref: 'main', oid: 'a'.repeat(40) },
      evidence: {
        state: 'known',
        value: 'factory-journal',
        sourceId: issueTemplate.metadata.sourceId,
        observedAt,
      },
    };
  }
  return {
    ...seed,
    entities: { ...seed.entities, issues, pullRequests, items, relationships, stacks, labels },
  };
}
