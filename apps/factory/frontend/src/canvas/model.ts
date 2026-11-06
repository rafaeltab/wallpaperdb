import type { FactoryV2Snapshot, WorkItem } from '../../../src/http/index.js';
import { routeCanvas, type Rect } from './routing';
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
export interface Card extends Rect {
  item: WorkItem;
}
export interface Group extends Rect {
  key: string;
  name: string;
  items: WorkItem[];
  stage: Stage;
  parent?: Issue;
  stack?: Board['entities']['stacks'][keyof Board['entities']['stacks']];
  collapsed: boolean;
  depth: number;
}
export interface Layout {
  cards: Card[];
  groups: Group[];
  areas: { id: Stage; name: string; y: number; height: number; count: number }[];
  routes: ReturnType<typeof routeCanvas>;
  width: number;
  height: number;
}

/** UI packing only. Placement, status, stack membership and attention come from the server. */
export function layout(board: Board, collapsed: ReadonlySet<string>): Layout {
  const items = Object.values(board.entities.items);
  const parents = new Map<string, string>();
  for (const r of Object.values(board.entities.relationships))
    if (r.kind === 'parent' && !parents.has(r.childIssueId))
      parents.set(r.childIssueId, r.parentIssueId);
  const groups: Group[] = [],
    cards: Card[] = [],
    areas: Layout['areas'] = [];
  const anchors = new Map<string, Rect>();
  let y = 48,
    width = 900;
  function order(list: WorkItem[]) {
    return [...list].sort((a, b) => {
      const rank = (i: WorkItem, kind: 'priority' | 'size') => {
        const p = metadataIssue(board, i)?.project;
        return p?.state === 'known'
          ? (p.value[kind]?.rank ?? Number.POSITIVE_INFINITY)
          : Number.POSITIVE_INFINITY;
      };
      // Prerequisites and highest priority sit nearer the bottom of the canvas.
      if (related(board, a, 'prerequisites').has(b.id)) return -1;
      if (related(board, b, 'prerequisites').has(a.id)) return 1;
      return (
        rank(b, 'priority') - rank(a, 'priority') ||
        rank(b, 'size') - rank(a, 'size') ||
        a.id.localeCompare(b.id)
      );
    });
  }
  for (const stage of stages) {
    const current = items.filter((i) => i.section === stage.id);
    if (!current.length && stage.id === 'unclassified') continue;
    const top = y;
    y += 32;
    const stacks = stage.id === 'in-review' ? Object.values(board.entities.stacks) : [];
    const stacked = new Set(stacks.flatMap((s) => [...s.pullRequestIdsBaseToTip]));
    type Spec = {
      key: string;
      name: string;
      parent?: Issue;
      stack?: Group['stack'];
      items: WorkItem[];
      children: Spec[];
    };
    const roots = new Map<string, Spec>();
    function parentSpec(id: string, seen: Set<string>): Spec | undefined {
      if (seen.has(id)) return undefined;
      seen.add(id);
      const entity = board.entities.issues[id as keyof typeof board.entities.issues];
      if (!entity) return undefined;
      const key = `${stage.id}:${id}`;
      const existing = roots.get(key);
      if (existing) return existing;
      const spec: Spec = { key, name: title(entity), parent: entity, items: [], children: [] };
      roots.set(key, spec);
      const ancestor = parents.get(id);
      const parent = ancestor ? parentSpec(ancestor, seen) : undefined;
      if (parent && !parent.children.includes(spec)) parent.children.push(spec);
      return spec;
    }
    const loose: WorkItem[] = [];
    for (const item of current) {
      if (item.subject.kind === 'pull-request' && stacked.has(item.subject.pullRequestId)) continue;
      const issue = metadataIssue(board, item);
      const parent = issue && parents.get(issue.id);
      const spec = parent ? parentSpec(parent, new Set([issue.id])) : undefined;
      if (spec) spec.items.push(item);
      else loose.push(item);
    }
    let specs = [...roots.values()].filter(
      (s) => ![...roots.values()].some((p) => p.children.includes(s))
    );
    if (loose.length)
      specs.push({
        key: `${stage.id}:loose`,
        name: stage.id === 'in-review' ? 'Independent pull requests' : 'Unparented issues',
        items: order(loose),
        children: [],
      });
    for (const stack of stacks) {
      const rows = [...stack.pullRequestIdsBaseToTip]
        .reverse()
        .flatMap((id) =>
          current.filter((i) => i.subject.kind === 'pull-request' && i.subject.pullRequestId === id)
        );
      if (rows.length)
        specs.push({
          key: `${stage.id}:${stack.id}`,
          name: 'PR stack',
          stack,
          items: rows,
          children: [],
        });
    }
    const allItems = (s: Spec): WorkItem[] => [...s.items, ...s.children.flatMap(allItems)];
    function groupWidth(spec: Spec): number {
      const hasPr = spec.items.some((item) => item.subject.kind === 'pull-request');
      const base = hasPr || spec.stack ? 760 : 400;
      if (collapsed.has(spec.key))
        return !spec.parent && !spec.stack
          ? Math.min(base, Math.max(180, spec.name.length * 7 + 60))
          : base;
      const packed = !hasPr && spec.items.length > 1 ? 808 : base;
      return Math.max(packed, ...spec.children.map((child) => groupWidth(child) + 24));
    }
    function place(spec: Spec, x: number, at: number, depth: number): number {
      const all = allItems(spec),
        isCollapsed = collapsed.has(spec.key);
      const w = groupWidth(spec);
      const group: Group = {
        id: spec.key,
        key: spec.key,
        x,
        y: at,
        width: w,
        height: 34,
        name: spec.name,
        parent: spec.parent,
        stack: spec.stack,
        items: all,
        stage: stage.id,
        collapsed: isCollapsed,
        depth,
      };
      groups.push(group);
      let next = at + 46;
      if (isCollapsed) {
        for (const item of all) anchors.set(item.id, { ...group, header: true });
      } else {
        const rows = spec.stack ? spec.items : order(spec.items);
        const columns =
          rows.length > 1 && rows.every((item) => item.subject.kind === 'issue') ? 2 : 1;
        let rowHeight = 0;
        for (const [index, item] of rows.entries()) {
          const column = index % columns;
          if (column === 0 && index > 0) {
            next += rowHeight + 32;
            rowHeight = 0;
          }
          const height = item.subject.kind === 'pull-request' ? 82 : 112;
          const card: Card = {
            id: item.id,
            item,
            x: x + 12 + column * 408,
            y: next,
            width: item.subject.kind === 'pull-request' ? w - 24 : 376,
            height,
            stacked: !!spec.stack,
          };
          cards.push(card);
          anchors.set(item.id, card);
          rowHeight = Math.max(rowHeight, height);
        }
        if (rows.length) next += rowHeight + 32;
        for (const child of spec.children) next += place(child, x + 12, next, depth + 1) + 32;
        group.height = Math.max(46, next - at - 16);
      }
      return group.height;
    }
    specs = specs.sort((a, b) => a.key.localeCompare(b.key));
    const bottoms = [y, y];
    for (const spec of specs) {
      const column = bottoms[0] <= bottoms[1] ? 0 : 1;
      const w = Math.max(...specs.map(groupWidth)) + 80;
      bottoms[column] += place(spec, 48 + column * w, bottoms[column], 0) + 48;
      width = Math.max(width, 48 + (column + 1) * w);
    }
    y = Math.max(...bottoms, y + 48) + 20;
    areas.push({ ...stage, y: top, height: y - top, count: current.length });
    y += 32;
  }
  const edges: { source: string; target: string }[] = [];
  for (const r of Object.values(board.entities.relationships)) {
    if (r.kind !== 'prerequisite' && r.kind !== 'pr-base') continue;
    const sources = items.filter((i) =>
      r.kind === 'prerequisite'
        ? issueIds(i).includes(r.dependantIssueId)
        : i.subject.kind === 'pull-request' && i.subject.pullRequestId === r.tipPullRequestId
    );
    const targets = items.filter((i) =>
      r.kind === 'prerequisite'
        ? issueIds(i).includes(r.prerequisiteIssueId)
        : i.subject.kind === 'pull-request' && i.subject.pullRequestId === r.basePullRequestId
    );
    for (const from of sources)
      for (const to of targets) {
        const a = anchors.get(from.id),
          b = anchors.get(to.id);
        if (a && b && (a.x !== b.x || a.y !== b.y)) edges.push({ source: from.id, target: to.id });
      }
  }
  return {
    cards,
    groups,
    areas,
    width: width + 48,
    height: y + 32,
    routes: routeCanvas(
      [
        ...[...anchors].map(([id, r]) => ({ ...r, id })),
        ...groups
          .filter((g) => !g.collapsed)
          .map((g) => ({ ...g, id: `header:${g.key}`, height: 34 })),
      ],
      [...new Map(edges.map((e) => [JSON.stringify([e.source, e.target]), e])).values()],
      width + 48,
      y + 32
    ),
  };
}
