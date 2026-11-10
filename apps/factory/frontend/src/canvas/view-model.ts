import type { WorkItem } from '../../../src/http/index.js';
import { issueIds, metadataIssue, subject, title, type Board, type Issue } from './model';
import type { Edge } from './routing';
import type { Stage } from './geometry-types';

export interface CanvasMetadata {
  number: number | null;
  title: string;
  url?: string;
  labels: { name: string; color: string }[];
  labelsKnown: boolean;
  priority: string | null;
  size: string | null;
  priorityRank?: number;
  sizeRank?: number;
  projectKnown: boolean;
}
export interface CanvasItem {
  /** Stable local geometry identity, independent of issue and PR numbers. */
  id: number;
  item: WorkItem;
  parent?: number;
  stage: Stage;
  status: string;
  active: boolean;
  pr?: number;
  prState?: 'open' | 'closed' | 'merged';
  draft?: boolean;
  prUrl?: string;
  issueNumbers: { number: number; url?: string }[];
  thread?: boolean;
}
export interface CanvasData {
  items: CanvasItem[];
  metadata: Record<number, CanvasMetadata>;
  parentIds: number[];
  parentOf: Record<number, number>;
  stackSpecs: { key: string; ids: number[]; stacked: boolean }[];
  connections: Edge[];
  selectionConnections?: Edge[];
}

/** Maps opaque contract identities to stable canvas IDs without interpreting their contents. */
export function createCanvasProjection() {
  const identities = new Map<string, number>();
  function identity(key: string) {
    let id = identities.get(key);
    if (id === undefined) {
      id = identities.size + 1;
      identities.set(key, id);
    }
    return id;
  }
  return (board: Board): CanvasData => {
    const metadata: CanvasData['metadata'] = {},
      items: CanvasItem[] = [];
    const issueNodes = new Map<string, number[]>(),
      prNodes = new Map<string, number[]>();
    const parentOf: Record<number, number> = {};
    const parentIssues = new Map<string, string>();
    const add = (map: Map<string, number[]>, key: string, value: number) =>
      map.set(key, [...(map.get(key) ?? []), value]);
    const meta = (entity: ReturnType<typeof subject>, issue?: Issue): CanvasMetadata => {
      const fields = issue?.project.state === 'known' ? issue.project.value : undefined;
      const labels = issue?.metadata ?? entity?.metadata;
      return {
        number: entity?.number ?? null,
        title: title(entity),
        url: entity?.metadata.state === 'known' ? entity.metadata.value.url : undefined,
        labelsKnown: labels?.state === 'known',
        labels:
          labels?.state === 'known'
            ? labels.value.labelIds.flatMap((id) => {
                const label = board.entities.labels[id];
                return label
                  ? [
                      {
                        name: label.name,
                        color: /^[0-9a-f]{6}$/i.test(label.color) ? label.color : '888888',
                      },
                    ]
                  : [];
              })
            : [],
        priority: fields?.priority?.name ?? null,
        size: fields?.size?.name ?? null,
        priorityRank: fields?.priority?.rank ?? undefined,
        sizeRank: fields?.size?.rank ?? undefined,
        projectKnown: fields !== undefined,
      };
    };
    for (const relation of Object.values(board.entities.relationships))
      if (relation.kind === 'parent' && !parentIssues.has(relation.childIssueId))
        parentIssues.set(relation.childIssueId, relation.parentIssueId);
    const parentIds = [...new Set(parentIssues.values())].map((key) => {
      const id = identity(key),
        issue = board.entities.issues[key as keyof Board['entities']['issues']];
      metadata[id] = meta(issue, issue);
      return id;
    });
    // Parent context is a namespace even when the same issue also has a work card.
    for (const [child, parent] of parentIssues) {
      if (!parentIssues.has(parent) && child === parent) continue;
      if (parentIds.includes(identity(child))) {
        let ancestor: string | undefined = parent,
          cyclic = child === parent;
        const seen = new Set([child]);
        while (ancestor && !cyclic) {
          if (seen.has(ancestor)) cyclic = true;
          seen.add(ancestor);
          ancestor = parentIssues.get(ancestor);
        }
        if (!cyclic) parentOf[identity(child)] = identity(parent);
      }
    }
    for (const item of Object.values(board.entities.items)) {
      const entity = subject(board, item),
        issue = metadataIssue(board, item),
        id = identity(item.id);
      const pr =
        item.subject.kind === 'pull-request'
          ? board.entities.pullRequests[item.subject.pullRequestId]
          : undefined;
      metadata[id] = meta(entity, issue);
      const parent = issue && parentIssues.get(issue.id);
      items.push({
        id,
        item,
        parent: parent ? identity(parent) : undefined,
        stage: item.section === 'in-review' ? 'review' : item.section,
        status: item.status.label,
        active: item.status.active,
        pr: pr?.number,
        prState: pr?.metadata.state === 'known' ? pr.metadata.value.state : undefined,
        prUrl: pr?.metadata.state === 'known' ? pr.metadata.value.url : undefined,
        draft: pr?.metadata.state === 'known' ? pr.metadata.value.draft : undefined,
        issueNumbers: issueIds(item).flatMap((key) => {
          const issue = board.entities.issues[key as keyof Board['entities']['issues']];
          return issue
            ? [
                {
                  number: issue.number,
                  url: issue.metadata.state === 'known' ? issue.metadata.value.url : undefined,
                },
              ]
            : [];
        }),
        thread: item.threadIds.length > 0,
      });
      for (const key of issueIds(item)) add(issueNodes, key, id);
      if (item.subject.kind === 'pull-request') add(prNodes, item.subject.pullRequestId, id);
    }
    const stackConnections: Edge[] = [];
    const connections: Edge[] = [],
      keys = new Set<string>();
    function connect(source: number, target: number) {
      const key = `${source}-${target}`;
      if (source !== target && !keys.has(key)) {
        keys.add(key);
        connections.push({ source, target });
      }
    }
    const nodes = (key: string) => [
      ...new Set([
        ...(issueNodes.get(key) ?? []),
        ...(parentIds.includes(identity(key)) ? [identity(key)] : []),
      ]),
    ];
    for (const edge of Object.values(board.entities.relationships)) {
      if (edge.kind === 'prerequisite')
        for (const source of nodes(edge.prerequisiteIssueId))
          for (const target of nodes(edge.dependantIssueId)) connect(source, target);
      if (edge.kind === 'pr-base')
        for (const source of prNodes.get(edge.basePullRequestId) ?? [])
          for (const target of prNodes.get(edge.tipPullRequestId) ?? [])
            stackConnections.push({ source, target });
    }
    const used = new Set<number>();
    const stackSpecs: CanvasData['stackSpecs'] = Object.values(board.entities.stacks).flatMap(
      (stack) => {
        const ids = stack.pullRequestIdsBaseToTip
          .flatMap((pr) => prNodes.get(pr) ?? [])
          .filter((id) => items.some((i) => i.id === id && i.stage === 'review') && !used.has(id));
        ids.forEach((id) => {
          used.add(id);
        });
        return ids.length ? [{ key: stack.id, ids, stacked: true }] : [];
      }
    );
    const independent = items.filter((i) => i.stage === 'review' && !used.has(i.id));
    if (independent.length)
      stackSpecs.push({ key: 'independent', ids: independent.map((i) => i.id), stacked: false });
    for (const edge of stackConnections)
      if (
        !stackSpecs.some(
          (stack) =>
            stack.stacked && stack.ids.includes(edge.source) && stack.ids.includes(edge.target)
        )
      )
        connect(edge.source, edge.target);
    return {
      items,
      metadata,
      parentIds,
      parentOf,
      stackSpecs,
      connections,
      selectionConnections: [
        ...connections,
        ...stackConnections.filter((edge) => !keys.has(`${edge.source}-${edge.target}`)),
      ],
    };
  };
}
