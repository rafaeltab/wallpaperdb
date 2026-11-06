import type { FactoryV2Snapshot, WorkItem } from '../../../src/http/index.js';
export type Board = FactoryV2Snapshot;
export type Issue = Board['entities']['issues'][string & keyof Board['entities']['issues']];
export type PullRequest =
  Board['entities']['pullRequests'][keyof Board['entities']['pullRequests']];
export type Stage = WorkItem['section'];
export const stages: { id: Stage; name: string }[] = [
  { id: 'planned', name: 'Planned' },
  { id: 'working', name: 'Working' },
  { id: 'in-review', name: 'In review' },
  { id: 'unclassified', name: 'Unclassified' },
];
export function subject(board: Board, item: WorkItem) {
  return item.subject.kind === 'issue'
    ? board.entities.issues[item.subject.issueId]
    : board.entities.pullRequests[item.subject.pullRequestId];
}
export function metadataIssue(board: Board, item: WorkItem) {
  const id = item.subject.kind === 'issue' ? item.subject.issueId : item.subject.metadataIssueId;
  return id ? board.entities.issues[id] : undefined;
}
export function issueIds(item: WorkItem): readonly string[] {
  return item.subject.kind === 'issue' ? [item.subject.issueId] : item.subject.issueIds;
}
export function title(entity?: Issue | PullRequest) {
  return entity?.metadata.state === 'known' ? entity.metadata.value.title : 'Title unavailable';
}
export function related(board: Board, item: WorkItem, direction: 'prerequisites' | 'dependants') {
  return relatedItems(board, [item], direction);
}
export function relatedItems(
  board: Board,
  seeds: readonly WorkItem[],
  direction: 'prerequisites' | 'dependants'
) {
  const seedIds = new Set(seeds.map((item) => item.id)),
    found = new Set<WorkItem['id']>(),
    queue = [...seeds];
  const allItems = Object.values(board.entities.items),
    edges = Object.values(board.entities.relationships);
  function add(item: WorkItem) {
    if (!seedIds.has(item.id) && !found.has(item.id)) {
      found.add(item.id);
      queue.push(item);
    }
  }
  for (let index = 0; index < queue.length; index++) {
    const current = queue[index];
    for (const id of relatedToIssues(board, issueIds(current), direction)) {
      const match = board.entities.items[id];
      if (match) add(match);
    }
    if (current.subject.kind !== 'pull-request') continue;
    const prs = new Set<string>([current.subject.pullRequestId]),
      pending = [current.subject.pullRequestId as string];
    for (let at = 0; at < pending.length; at++)
      for (const edge of edges) {
        if (edge.kind !== 'pr-base') continue;
        const from = direction === 'prerequisites' ? edge.tipPullRequestId : edge.basePullRequestId;
        const to = direction === 'prerequisites' ? edge.basePullRequestId : edge.tipPullRequestId;
        if (from !== pending[at] || prs.has(to)) continue;
        prs.add(to);
        pending.push(to);
        for (const match of allItems)
          if (match.subject.kind === 'pull-request' && match.subject.pullRequestId === to)
            add(match);
      }
  }
  return found;
}
export function relatedToIssues(
  board: Board,
  issueIdsToFind: readonly string[],
  direction: 'prerequisites' | 'dependants'
) {
  const ids = new Set(issueIdsToFind);
  const found = new Set<string>();
  const queue = [...ids];
  for (let i = 0; i < queue.length; i++) {
    for (const edge of Object.values(board.entities.relationships)) {
      if (edge.kind !== 'prerequisite') continue;
      const from = direction === 'prerequisites' ? edge.dependantIssueId : edge.prerequisiteIssueId;
      const to = direction === 'prerequisites' ? edge.prerequisiteIssueId : edge.dependantIssueId;
      if (from === queue[i] && !ids.has(to) && !found.has(to)) {
        found.add(to);
        queue.push(to);
      }
    }
  }
  return new Set(
    Object.values(board.entities.items)
      .filter((i) => issueIds(i).some((id) => found.has(id)))
      .map((i) => i.id)
  );
}
