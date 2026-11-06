// Throwaway UI study. GitHub metadata is a read-only snapshot; workflow, parents, stacks and commands are simulated.
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as Pointer,
  type CSSProperties,
} from 'react';
import { issueMetadata as baseMetadata } from './factory-metadata-fixture';
import { searchSnapshot } from './factory-search-fixture';
import {
  buildScaleFixture,
  buildNestedFixture,
  type CanvasItem,
  type FixtureBundle,
} from './factory-scale-fixture';
import { routeCanvas, type Rect, type Edge } from './canvas-routing-prototype';
import reviewer from './prototype-reviewer.png';
import { prototypePrIcons } from './prototype-octicons';
import './factory-canvas-prototype.css';

type Stage = 'planned' | 'working' | 'review';
type Item = CanvasItem;
type Scenario =
  | 'varied'
  | 'mixed12'
  | 'parents'
  | 'parents-reversed'
  | 'nested'
  | 'scale100'
  | 'scale200'
  | 'scale300';
const foundation = 'c9ba7a79-9738-4af8-80c9-61ca104f6874';
const reviewRows = [
  { id: 646, pr: 653, parent: 644, thread: foundation },
  { id: 515, pr: 524, thread: 'mcp:d2a425ca-9696-4146-aec5-554d830ba751' },
  { id: 647, pr: 657, parent: 644, thread: foundation },
  { id: 658, pr: 664, parent: 628, thread: '9ed8321b-9acb-4a35-95d7-e6814cb996ef' },
  { id: 527, pr: 531, thread: 'mcp:09b62e4a-fc1c-4245-afdf-74b876885867' },
  { id: 649, pr: 670, parent: 644, thread: foundation },
  { id: 663, pr: 669, parent: 628, thread: '1d3f638d-dc41-447d-817f-307997f69fa1' },
  { id: 528, pr: 532, thread: 'mcp:36b240d8-3a92-4896-9715-1b592cb5b961' },
  { id: 650, pr: 671, parent: 644, thread: foundation },
  { id: 519, pr: 561, parent: 628, thread: 'mcp:758d0180-70e1-4210-ac30-9705944a4a47' },
  { id: 520, pr: 602, thread: 'mcp:b61e21de-cb5f-4647-b479-0c1594fb6f3f' },
  { id: 648, pr: 672, parent: 644, thread: foundation },
];
const baseRecords: Item[] = [
  { id: 666, parent: 644, stage: 'planned', deps: [651], status: 'Blocked' },
  { id: 651, parent: 644, stage: 'planned', deps: [645, 668], status: 'Blocked' },
  { id: 656, parent: 644, stage: 'planned', deps: [645], status: 'Blocked' },
  { id: 612, parent: 628, stage: 'planned', deps: [668], status: 'Blocked' },
  { id: 627, parent: 628, stage: 'planned', deps: [], status: 'Ready' },
  { id: 630, stage: 'planned', deps: [555], status: 'Blocked' },
  { id: 483, stage: 'planned', deps: [555], status: 'Blocked' },
  { id: 642, stage: 'planned', deps: [], status: 'Ready' },
  { id: 8, stage: 'planned', deps: [], status: 'Ready' },
  {
    id: 645,
    parent: 644,
    stage: 'working',
    deps: [648],
    status: 'Implementing',
    thread: 'mcp:97234656-7780-4162-8809-d89a95def354',
  },
  {
    id: 668,
    parent: 628,
    stage: 'working',
    deps: [663],
    status: 'Reviewing code',
    thread: 'efe6d4bb-9c10-419a-a03a-d0f99753a05c',
  },
  {
    id: 555,
    stage: 'working',
    deps: [520],
    status: 'Manual recovery',
    thread: 'mcp:ad6112dc-7cf3-446b-b887-d6b017c84dbb',
  },
  ...reviewRows.map<Item>((row, index) => ({
    ...row,
    stage: 'review',
    deps: [],
    status: row.id === 650 ? 'Babysitting' : row.id === 520 ? 'Repairing CI' : 'Draft',
    approved: index % 3 !== 2,
    conflicts: row.id === 658,
    draft: row.parent === 644 || index % 4 === 0,
    checks:
      index === 10
        ? ['passed', 'failed', 'passed', 'passed']
        : index >= 8
          ? ['passed', 'running', 'running', 'passed']
          : ['passed', 'passed', 'passed', 'passed'],
  })),
];
const checkNames = ['CI', 'Browser E2E', 'Coverage', 'Type checking'];
const stages: { id: Stage; name: string }[] = [
  { id: 'planned', name: 'Planned' },
  { id: 'working', name: 'Working' },
  { id: 'review', name: 'In review' },
];
const CARD_W = 384,
  PR_W = 768,
  PR_H = 56;
const GITHUB = 'https://github.com/rafaeltab/wallpaperdb';
type Box = Rect & { item: Item };
type Group = {
  key: string;
  parent?: number;
  stage: Stage;
  x: number;
  y: number;
  width: number;
  height: number;
  head: number;
  headingWidth: number;
  depth: number;
  collapsed: boolean;
  ids: number[];
};
type StackRow = {
  item: Item;
  key: string;
  y: number;
  height: number;
  offset: number;
};
type Panel = {
  key: string;
  name: string;
  ids: number[];
  x: number;
  y: number;
  width: number;
  height: number;
  stacked: boolean;
  rows: StackRow[];
  collapsed: boolean;
};
type TitleMode = 'wrap' | 'ellipsis' | 'expand';
type HighlightStyle = 'white' | 'status' | 'status-glow' | 'slate' | 'teal';
type RelationshipMode = 'direct' | 'transitive' | 'all';
type RelationshipDirection = 'both' | 'prerequisites' | 'dependants';
type CanvasFocus = { id: number; instance: string };
type LayoutOptions = {
  titleMode: TitleMode;
  expandedNames: Set<string>;
  hoverName?: string;
  collapsed?: Set<string>;
};
const scenarioChoices: { id: Scenario; name: string }[] = [
  { id: 'varied', name: 'Varied stacks' },
  { id: 'mixed12', name: '12-PR mixed stack' },
  { id: 'parents', name: 'Parent dependencies' },
  { id: 'parents-reversed', name: 'Parent dependency reversed' },
  { id: 'nested', name: 'Multi-level parents' },
  { id: 'scale100', name: '100 issues' },
  { id: 'scale200', name: '200 issues' },
  { id: 'scale300', name: '300 issues' },
];
const nestedFixture = buildNestedFixture(baseRecords, baseMetadata);
const scaleFixtures = {
  scale100: buildScaleFixture(100),
  scale200: buildScaleFixture(200),
  scale300: buildScaleFixture(300),
};
const issueMetadata = {
  ...baseMetadata,
  ...scaleFixtures.scale300.metadata,
  ...nestedFixture.metadata,
};
function fixtureFor(scenario: Scenario): FixtureBundle {
  if (scenario === 'nested') return nestedFixture;
  if (scenario === 'scale100' || scenario === 'scale200' || scenario === 'scale300')
    return scaleFixtures[scenario];
  return {
    items: baseRecords,
    metadata: baseMetadata,
    parentIds: [644, 628],
    parentOf: {},
    synthetic: false,
    stackSpecs:
      scenario === 'mixed12'
        ? [{ key: 'mixed12', ids: reviewRows.map((i) => i.id), stacked: true }]
        : [
            { key: 'factory', ids: [646, 649, 650, 648], stacked: true },
            { key: 'mixed', ids: [515, 647, 658, 528, 519], stacked: true },
            { key: 'independent', ids: [527, 663, 520], stacked: false },
          ],
  };
}
let measureContext: CanvasRenderingContext2D | null | undefined;
function textWidth(text: string, size: number) {
  if (measureContext === undefined)
    measureContext =
      typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
  if (!measureContext) return text.length * size * 0.51;
  measureContext.font = `${size}px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif`;
  return measureContext.measureText(text).width;
}
function linesFor(text: string, width: number, size: number) {
  let lines = 1,
    current = '';
  for (const word of text.split(' ')) {
    if (current && textWidth(`${current} ${word}`, size) > width) {
      lines++;
      current = word;
    } else current = current ? `${current} ${word}` : word;
  }
  return lines;
}
function arrangeIssues(members: Item[], connections: Edge[], heightOf: (item: Item) => number) {
  const localIds = new Set(members.map((i) => i.id));
  const localEdges = connections.filter((e) => localIds.has(e.source) && localIds.has(e.target));
  const connected = new Set(connections.flatMap((e) => [e.source, e.target]));
  const priority = (item: Item) =>
    ['P0', 'P1', 'P2', 'P3', 'P4'].indexOf(issueMetadata[item.id].priority ?? '');
  const size = (item: Item) =>
    ['XS', 'S', 'M', 'L', 'XL'].indexOf(issueMetadata[item.id].size ?? '');
  const compare = (a: Item, b: Item) =>
    (priority(a) < 0 ? 99 : priority(a)) - (priority(b) < 0 ? 99 : priority(b)) ||
    (size(a) < 0 ? 99 : size(a)) - (size(b) < 0 ? 99 : size(b)) ||
    a.id - b.id;
  const unseen = new Set(localIds),
    components: Item[][] = [];
  while (unseen.size) {
    const queue = [unseen.values().next().value!],
      ids = new Set<number>();
    while (queue.length) {
      const id = queue.pop()!;
      if (ids.has(id)) continue;
      ids.add(id);
      unseen.delete(id);
      for (const e of localEdges) {
        if (e.source === id && !ids.has(e.target)) queue.push(e.target);
        if (e.target === id && !ids.has(e.source)) queue.push(e.source);
      }
    }
    components.push(members.filter((i) => ids.has(i.id)));
  }
  const units = components
    .map((items) => {
      const ranks = new Map<number, number>();
      const rank = (item: Item): number => {
        if (ranks.has(item.id)) return ranks.get(item.id)!;
        const deps = localEdges
          .filter((e) => e.target === item.id)
          .map((e) => items.find((i) => i.id === e.source)!);
        const value = deps.length ? 1 + Math.max(...deps.map(rank)) : 0;
        ranks.set(item.id, value);
        return value;
      };
      const levels = [...new Set(items.map(rank))].sort((a, b) => a - b);
      const columns = Math.min(
        2,
        Math.max(...levels.map((l) => items.filter((i) => rank(i) === l).length))
      );
      const nodes: { item: Item; column: number; up: number; height: number }[] = [];
      let up = 0;
      levels.forEach((level, levelIndex) => {
        const row = items.filter((i) => rank(i) === level).sort(compare);
        for (let index = 0; index < row.length; index += columns) {
          const chunk = row.slice(index, index + columns),
            height = Math.max(...chunk.map(heightOf));
          chunk.forEach((item, column) => nodes.push({ item, column, up, height: heightOf(item) }));
          up +=
            height + (index + columns < row.length ? 12 : levelIndex < levels.length - 1 ? 60 : 0);
        }
      });
      return {
        nodes,
        columns,
        height: up,
        connected: items.some((i) => connected.has(i.id)),
        first: items.filter((i) => rank(i) === 0).sort(compare)[0],
      };
    })
    .sort((a, b) => Number(b.connected) - Number(a.connected) || compare(a.first, b.first));
  const placements: { item: Item; x: number; y: number; width: number; height: number }[] = [];
  const columnHeights = [0, 0],
    occupied = [false, false];
  let usedColumns = 0;
  // Pack the approximate work order into both lanes; each dependency chain stays intact.
  for (const unit of units) {
    const incoming = unit.nodes.some(
      (n) => n.up === 0 && connections.some((e) => e.target === n.item.id)
    );
    const gap = incoming ? 60 : 12;
    const starts = columnHeights.map((height, column) => height + (occupied[column] ? gap : 0));
    const column = unit.columns === 2 || starts[0] <= starts[1] ? 0 : 1;
    const bottom = unit.columns === 2 ? Math.max(...starts) : starts[column];
    for (const node of unit.nodes)
      placements.push({
        item: node.item,
        x: (column + node.column) * (CARD_W + 40),
        y: bottom + node.up,
        width: CARD_W,
        height: node.height,
      });
    for (let index = column; index < column + unit.columns; index++) {
      columnHeights[index] = bottom + unit.height;
      occupied[index] = true;
    }
    usedColumns = Math.max(usedColumns, column + unit.columns);
  }
  const height = Math.max(...columnHeights);
  for (const p of placements) p.y = height - p.y - p.height;
  return {
    placements,
    height,
    width: usedColumns ? usedColumns * CARD_W + (usedColumns - 1) * 40 : 0,
  };
}
function layout(scenario: Scenario, options: LayoutOptions) {
  const fixture = fixtureFor(scenario),
    records = fixture.items,
    parents = fixture.parentIds;
  const connections = records
    .filter((i) => !i.pr)
    .flatMap((i) => i.deps.map((id) => ({ source: id, target: i.id })));
  if (scenario === 'parents' || scenario === 'nested')
    connections.push({ source: 642, target: 644 }, { source: 628, target: 666 });
  if (scenario === 'parents-reversed')
    connections.push({ source: 644, target: 642 }, { source: 628, target: 666 });
  const boxes: Box[] = [],
    groups: Group[] = [],
    areas: { id: Stage; name: string; y: number; height: number; width: number }[] = [];
  const isExpanded = (key: string) =>
    options.titleMode === 'expand' && (options.expandedNames.has(key) || options.hoverName === key);
  const titleLines = (id: number, width: number, size: number, key: string) =>
    isExpanded(key)
      ? linesFor(issueMetadata[id].title, width, size)
      : options.titleMode === 'wrap'
        ? Math.min(2, linesFor(issueMetadata[id].title, width, size))
        : 1;
  const issueHeight = (item: Item) =>
    (issueMetadata[item.id].labels.length ? 64 : 40) +
    18 * titleLines(item.id, CARD_W - 24, 13, `issue:${item.id}`);
  const labelColumn =
    Math.ceil(
      Math.max(
        0,
        ...records
          .filter((i) => i.pr)
          .map((i) => {
            const ls = issueMetadata[i.id].labels,
              shown = ls.slice(0, 2);
            return (
              shown.reduce((w, l) => w + Math.min(155, textWidth(l.name, 9) + 12), 0) +
              Math.max(0, shown.length - 1) * 4 +
              (ls.length > 2 ? textWidth(`+${ls.length - 2}`, 9) + 4 : 0)
            );
          })
      ) / 4
    ) * 4;
  const badgeWidth = Math.max(120, PR_W - 16 - 20 - labelColumn - 24 - 98);
  const prHeight = (item: Item) =>
    PR_H +
    Math.max(
      0,
      18 *
        titleLines(
          item.id,
          PR_W -
            16 -
            20 -
            (textWidth(`#${item.pr}`, 11) + textWidth(`#${item.id}`, 10) + 34 + 8) -
            84 -
            47 -
            24 -
            (item.thread || item.synthetic ? 31 : 0),
          12,
          `issue:${item.id}`
        ) -
        19
    ) +
    (item.parent && (options.titleMode === 'wrap' || isExpanded(`badge:${item.id}`))
      ? Math.max(
          0,
          15 *
            (options.titleMode === 'wrap'
              ? Math.min(
                  2,
                  linesFor(`#${item.parent} ${issueMetadata[item.parent].title}`, badgeWidth, 9)
                )
              : linesFor(`#${item.parent} ${issueMetadata[item.parent].title}`, badgeWidth, 9)) -
            19
        )
      : 0);
  const padding = 12;
  let y = 32;
  for (const stage of stages.filter((s) => s.id !== 'review')) {
    let maxRight = 32,
      maxBottom = y + 32;
    const stageItems = records.filter((i) => i.stage === stage.id);
    const hasContent = (parent: number): boolean =>
      stageItems.some((i) => i.parent === parent) ||
      parents.some((id) => fixture.parentOf[id] === parent && hasContent(id));
    type Plan = {
      parent?: number;
      width: number;
      height: number;
      head: number;
      issueLayout: ReturnType<typeof arrangeIssues>;
      children: Plan[];
      depth: number;
      collapsed: boolean;
      ids: number[];
    };
    const plan = (parent: number | undefined, depth = 0): Plan => {
      const members = stageItems.filter((i) => i.parent === parent);
      const issueLayout = arrangeIssues(members, connections, issueHeight);
      const children = parent
        ? parents
            .filter((id) => fixture.parentOf[id] === parent && hasContent(id))
            .map((id) => plan(id, depth + 1))
        : [];
      const widths = [
        ...(issueLayout.width ? [issueLayout.width] : []),
        ...children.map((c) => c.width),
      ];
      const collapsed = options.collapsed?.has(`${stage.id}-${parent ?? 'none'}`) ?? false;
      const width = collapsed
        ? CARD_W + padding * 2
        : widths.reduce((a, b) => a + b, 0) + Math.max(0, widths.length - 1) * 48 + padding * 2;
      const head = parent
        ? Math.max(
            32,
            16 + 15 * titleLines(parent, width - 136, 11, `parent:${stage.id}:${parent}`)
          )
        : 32;
      return {
        parent,
        width,
        height: collapsed
          ? head
          : head + padding * 2 + Math.max(issueLayout.height, ...children.map((c) => c.height)),
        head,
        issueLayout,
        children,
        depth,
        collapsed,
        ids: [...members.map((i) => i.id), ...children.flatMap((c) => c.ids)],
      };
    };
    const place = (p: Plan, gx: number, gy: number) => {
      groups.push({
        key: `${stage.id}-${p.parent ?? 'none'}`,
        parent: p.parent,
        stage: stage.id,
        x: gx,
        y: gy,
        width: p.width,
        height: p.height,
        head: p.head,
        headingWidth: p.parent
          ? p.width
          : Math.ceil(
              37 + textWidth('Unparented issues', 11) + 7 + textWidth(String(p.ids.length), 9) + 12
            ),
        depth: p.depth,
        collapsed: p.collapsed,
        ids: p.ids,
      });
      if (p.collapsed) return;
      for (const node of p.issueLayout.placements)
        boxes.push({
          id: node.item.id,
          item: node.item,
          x: gx + padding + node.x,
          y: gy + p.head + padding + node.y,
          width: node.width,
          height: node.height,
        });
      let childX = gx + padding + (p.issueLayout.width ? p.issueLayout.width + 48 : 0);
      for (const child of p.children) {
        place(child, childX, gy + p.head + padding);
        childX += child.width + 48;
      }
    };
    const roots = parents.filter((id) => !fixture.parentOf[id] && hasContent(id));
    const plans = [
      ...roots.map((id) => plan(id)),
      ...(stageItems.some((i) => i.parent === undefined) ? [plan(undefined)] : []),
    ];
    if (options.titleMode === 'wrap') {
      const head = Math.max(...plans.map((p) => p.head));
      for (const p of plans) {
        p.height += head - p.head;
        p.head = head;
      }
    }
    const columns = fixture.items.length >= 100 ? Math.min(3, plans.length) : plans.length;
    const columnWidths = Array<number>(columns).fill(0),
      columnY = Array<number>(columns).fill(y + 32);
    plans.forEach((p, index) => {
      const column = index % columns;
      columnWidths[column] = Math.max(columnWidths[column], p.width);
    });
    let nextX = 32;
    const columnX = columnWidths.map((width) => {
      const x = nextX;
      nextX += width + 48;
      return x;
    });
    const incoming = new Set(connections.map((e) => e.target));
    for (const [index, p] of plans.entries()) {
      const column = index % columns,
        x = columnX[column],
        rowY = columnY[column];
      const firstBox = boxes.length,
        firstGroup = groups.length;
      place(p, x, rowY);
      maxBottom = Math.max(maxBottom, rowY + p.height);
      maxRight = Math.max(maxRight, x + p.width);
      // Pack below this group, reserving only the space needed by bottom connection ports.
      const ports = [
        ...boxes
          .slice(firstBox)
          .filter((b) => incoming.has(b.id))
          .map((b) => b.y + b.height + 20),
        ...groups
          .slice(firstGroup)
          .filter(
            (g) =>
              g.collapsed &&
              connections.some(
                (e) =>
                  (g.ids.includes(e.target) || e.target === g.parent) &&
                  !g.ids.includes(e.source) &&
                  e.source !== g.parent
              )
          )
          .map((g) => g.y + g.height + 20),
      ];
      columnY[column] = Math.max(rowY + p.height + 12, ...ports.map((end) => end + 32));
    }
    areas.push({ ...stage, y, height: maxBottom - y + 12, width: maxRight + 32 });
    y = maxBottom + 48;
  }
  const panels: Panel[] = [];
  let maxRight = 32,
    maxBottom = y + 32;
  const specs = fixture.stackSpecs;
  const columns = fixture.items.length >= 100 ? Math.min(3, specs.length) : specs.length;
  const columnY = Array<number>(columns).fill(y + 32);
  for (const [index, spec] of specs.entries()) {
    const column = index % columns,
      x = 32 + column * (PR_W + 96),
      rowY = columnY[column];
    const isCollapsed = options.collapsed?.has(`stack:${spec.key}`) ?? false;
    const ids = isCollapsed ? [] : [...spec.ids].reverse(),
      rows: StackRow[] = [];
    let offset = 32;
    for (const id of ids) {
      const item = records.find((i) => i.id === id)!;
      const height = prHeight(item);
      rows.push({ item, key: String(id), y: rowY + offset, offset, height });
      offset += height + (spec.stacked ? 0 : 12);
    }
    if (!spec.stacked && !isCollapsed) offset -= 12;
    const panel: Panel = {
      ...spec,
      name: spec.stacked ? 'PR stack' : 'Independent pull requests',
      x,
      y: rowY,
      width: PR_W,
      height: offset,
      rows,
      collapsed: isCollapsed,
    };
    panels.push(panel);
    for (const row of rows)
      if (row.item)
        boxes.push({
          id: row.item.id,
          item: row.item,
          x: x + 8,
          y: row.y,
          width: PR_W - 16,
          height: row.height,
          stacked: spec.stacked,
        });
    maxBottom = Math.max(maxBottom, rowY + offset);
    maxRight = Math.max(maxRight, x + PR_W);
    columnY[column] = rowY + offset + 12;
  }
  areas.push({
    id: 'review',
    name: 'In review',
    y,
    height: maxBottom - y + 12,
    width: maxRight + 32,
  });
  const width = Math.max(...areas.map((a) => a.width)) + 16,
    height = maxBottom + 48;
  const headerNodes: Rect[] = groups
    .filter((g) => g.parent)
    .map((g) => ({
      id: g.parent ?? 0,
      x: g.x,
      y: g.y,
      width: g.width,
      height: g.head,
      header: !g.collapsed,
    }));
  // Hidden nodes keep external relationships through their visible group/stack header.
  const aggregateNodes: Rect[] = [],
    representatives = new Map<number, number>();
  const visibleIds = new Set(boxes.map((b) => b.id));
  const visibleParents = new Set(headerNodes.map((n) => n.id));
  const parentContains = (ancestor: number, id: number) => {
    let current: number | undefined = id;
    while (current !== undefined) {
      if (current === ancestor) return true;
      current = fixture.parentOf[current];
    }
    return false;
  };
  groups.forEach((group, index) => {
    if (!group.collapsed) return;
    const id = -1_000_000 - index;
    aggregateNodes.push({
      id,
      x: group.x,
      y: group.y,
      width: group.headingWidth,
      height: group.head,
      header: false,
      bottomPort: group.parent
        ? undefined
        : { x: group.x + 37, width: textWidth('Unparented issues', 11) },
    });
    for (const item of group.ids) representatives.set(item, id);
    if (group.parent)
      for (const parent of parents)
        if (
          !visibleParents.has(parent) &&
          parentContains(group.parent, parent) &&
          !representatives.has(parent)
        )
          representatives.set(parent, id);
  });
  panels.forEach((panel, index) => {
    const hidden = panel.ids.filter((id) => !visibleIds.has(id));
    if (!hidden.length) return;
    const id = -2_000_000 - index;
    aggregateNodes.push({
      id,
      x: panel.x,
      y: panel.y,
      width: panel.width,
      height: 32,
      header: false,
    });
    for (const item of hidden) representatives.set(item, id);
  });
  const routeRelationships = new Map<string, Edge[]>(),
    routingConnections: Edge[] = [];
  for (const edge of connections) {
    const source = representatives.get(edge.source) ?? edge.source;
    const target = representatives.get(edge.target) ?? edge.target;
    if (source === target) continue;
    const key = `${source}-${target}`,
      previous = routeRelationships.get(key);
    if (previous) previous.push(edge);
    else {
      routeRelationships.set(key, [edge]);
      routingConnections.push({ source, target });
    }
  }
  return {
    boxes,
    groups,
    panels,
    areas,
    width,
    height,
    connections,
    headerNodes,
    aggregateNodes,
    routingConnections,
    routeRelationships,
    labelColumn,
    fixture,
  };
}
function relationshipHighlights(
  active: number | undefined,
  connections: Edge[],
  parents: Record<number, number>,
  parentIds: number[],
  mode: RelationshipMode,
  direction: RelationshipDirection = 'both'
) {
  // A parent completes after its children. Membership points child -> parent.
  // Walk each direction separately; never turn around at a shared parent or dependant.
  const edges =
    mode === 'direct'
      ? connections
      : [
          ...connections,
          ...Object.entries(parents).map(([child, parent]) => ({
            source: Number(child),
            target: parent,
          })),
        ];
  const prerequisiteEdges = new Set<string>(),
    dependantEdges = new Set<string>();
  const walk = (backwards: boolean, traversed: Set<string>) => {
    const seen = new Set<number>();
    if (active === undefined) return seen;
    const queue = [active];
    while (queue.length) {
      const id = queue.pop();
      for (const edge of edges) {
        if ((backwards ? edge.target : edge.source) !== id) continue;
        traversed.add(`${edge.source}-${edge.target}`);
        const next = backwards ? edge.source : edge.target;
        if (next === active || seen.has(next)) continue;
        seen.add(next);
        if (mode !== 'direct') queue.push(next);
      }
    }
    return seen;
  };
  const prerequisites = walk(true, prerequisiteEdges),
    dependants = walk(false, dependantEdges);
  if (active !== undefined && parentIds.includes(active) && mode === 'direct')
    for (const [child, parent] of Object.entries(parents))
      if (parent === active) prerequisites.add(Number(child));
  // Traverse through parents, but omit them from the results when their highlights are hidden.
  if (mode === 'transitive')
    for (const parent of parentIds) {
      prerequisites.delete(parent);
      dependants.delete(parent);
    }
  const related = new Set<number>([
    ...(direction !== 'dependants' ? prerequisites : []),
    ...(direction !== 'prerequisites' ? dependants : []),
  ]);
  const activeEdges = new Set<string>([
    ...(direction !== 'dependants' ? prerequisiteEdges : []),
    ...(direction !== 'prerequisites' ? dependantEdges : []),
  ]);
  if (active !== undefined) related.add(active);
  const highlightedParents = new Set(
    parentIds.filter((id) => related.has(id) && (mode !== 'transitive' || id === active))
  );
  return { prerequisites, dependants, related, highlightedParents, activeEdges };
}
function statusAppearance(status: string) {
  if (['Implementing', 'Babysitting', 'CI running'].includes(status))
    return { className: 'cc-blue', color: '#83aff0' };
  if (['Reviewing code', 'Needs review'].includes(status))
    return { className: 'cc-purple', color: '#b59de4' };
  if (status === 'Ready' || status === 'Open') return { className: 'cc-green', color: '#59caa5' };
  if (status === 'Draft') return { className: 'cc-muted', color: '#90909e' };
  if (status === 'Conflict' || status === 'CI failed')
    return { className: 'cc-red', color: '#df8d96' };
  if (status === 'Cancelled') return { className: 'cc-muted', color: '#777786' };
  return { className: 'cc-amber', color: '#d4b17d' };
}
function statusIsActive(status: string) {
  return [
    'Implementing',
    'Reviewing code',
    'Restacking',
    'Babysitting',
    'Repairing CI',
    'CI running',
  ].includes(status);
}
function displayStatus(item: Item, restacking: boolean) {
  if (!item.pr || item.status === 'Manual recovery') return item.status;
  if (item.id === 648 && restacking) return 'Restacking';
  if (item.conflicts) return 'Conflict';
  if (item.status === 'Repairing CI' || item.status === 'Babysitting') return item.status;
  if (item.checks?.includes('failed')) return 'CI failed';
  if (item.checks?.includes('running')) return 'CI running';
  return item.approved ? 'Ready' : 'Needs review';
}
function requiresHumanAttention(item: Item, restacking: boolean) {
  // Conflict recovery and CI repairs are automatic until they require manual recovery.
  return ['Needs review', 'Manual recovery'].includes(displayStatus(item, restacking));
}
function statusSummary(items: Item[], restacking: boolean) {
  const counts = new Map<string, number>();
  for (const item of items) {
    const status = displayStatus(item, restacking);
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }
  const order = [
    'Conflict',
    'CI failed',
    'Repairing CI',
    'Restacking',
    'CI running',
    'Babysitting',
    'Needs review',
    'Ready',
  ];
  const rank = (status: string) => {
    const index = order.indexOf(status);
    return index < 0 ? order.length : index;
  };
  return [...counts]
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => rank(a.status) - rank(b.status) || a.status.localeCompare(b.status));
}
function Icon({ kind, size = 14 }: { kind: string; size?: number }) {
  if (kind === 'pr' || kind === 'draft-pr')
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 16 16"
        fill="currentColor"
        stroke="none"
        aria-hidden="true"
        data-icon={`github-${kind}`}
      >
        <path d={prototypePrIcons[kind]} />
      </svg>
    );
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {kind === 'passed' ? (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="m8 12 3 3 5-6" />
        </>
      ) : kind === 'failed' ? (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="m9 9 6 6m0-6-6 6" />
        </>
      ) : kind === 'running' ? (
        <>
          <circle cx="12" cy="12" r="9" strokeDasharray="23 10" />
          <path d="M12 7v5l3 2" />
        </>
      ) : kind === 'gear' ? (
        <>
          <path d="m9 3-1 3-3 1-2 3 2 2-1 3 3 2 1 3h4l2-2 3 1 3-3-1-3 2-2-2-3-3-1-1-3Z" />
          <circle cx="12" cy="12" r="3" />
        </>
      ) : kind === 'thread' ? (
        <>
          <rect x="3" y="4" width="18" height="13" rx="3" />
          <path d="m7 17-1 4 6-4M7 9h10m-10 4h6" />
        </>
      ) : kind === 'restack' ? (
        <>
          <path d="M20 10a8 8 0 0 0-14-4L3 9m0-6v6h6M4 14a8 8 0 0 0 14 4l3-3m0 6v-6h-6" />
        </>
      ) : kind === 'fit' ? (
        <path d="M3 9V3h6m6 0h6v6m0 6v6h-6M9 21H3v-6" />
      ) : kind === 'eye' ? (
        <>
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
          <circle cx="12" cy="12" r="3" />
        </>
      ) : kind === 'attention' ? (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v6m0 4h.01" />
        </>
      ) : kind === 'play' ? (
        <path d="m8 5 11 7-11 7Z" fill="currentColor" stroke="none" />
      ) : kind === 'stop' ? (
        <>
          <path d="M8 3h8l5 5v8l-5 5H8l-5-5V8Z" />
          <rect x="8" y="8" width="8" height="8" rx=".5" fill="currentColor" stroke="none" />
        </>
      ) : kind === 'collapse' ? (
        <path d="m6 4 6 6 6-6m-12 16 6-6 6 6" strokeWidth="2.4" />
      ) : kind === 'expand' ? (
        <path d="m6 9 6-6 6 6m-12 6 6 6 6-6" strokeWidth="2.4" />
      ) : (
        <>
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="12" r="2" />
        </>
      )}
    </svg>
  );
}
function Identity({ item }: { item: Item }) {
  const meta = issueMetadata[item.id];
  if (item.synthetic || !meta.url)
    return (
      <span
        className="cc-identity cc-synthetic"
        data-tip={
          item.pr
            ? `Synthetic ${item.draft ? 'draft' : 'open'} PR. No GitHub destination.`
            : 'Synthetic issue. No GitHub destination.'
        }
      >
        {item.pr && (
          <span className={`cc-id-entry ${item.draft ? 'cc-muted' : 'cc-green'}`}>
            <Icon kind={item.draft ? 'draft-pr' : 'pr'} />
            <span>#{item.pr}</span>
          </span>
        )}
        <span className="cc-id-entry cc-issue-number">
          <Icon kind="issue" size={item.pr ? 12 : 14} />
          <span>#{item.id}</span>
        </span>
      </span>
    );
  return (
    <span className="cc-identity">
      {item.pr && (
        <>
          <a
            href={`${GITHUB}/pull/${item.pr}`}
            target="_blank"
            rel="noreferrer"
            className={`cc-id-entry ${item.draft ? 'cc-muted' : 'cc-green'}`}
            data-tip={`Pull request #${item.pr} · ${item.draft ? 'Draft' : 'Open'}`}
          >
            <Icon kind={item.draft ? 'draft-pr' : 'pr'} />
            <span>#{item.pr}</span>
          </a>
        </>
      )}
      <a
        className="cc-id-entry cc-issue-number"
        href={meta.url}
        target="_blank"
        rel="noreferrer"
        data-tip={`Issue #${item.id}`}
      >
        <Icon kind="issue" size={item.pr ? 12 : 14} />
        <span>#{item.id}</span>
      </a>
    </span>
  );
}
function Fields({ id }: { id: number }) {
  const item = issueMetadata[id];
  return (
    <span className="cc-fields">
      <span
        className={item.priority === 'P0' ? 'cc-red' : item.priority === 'P1' ? 'cc-amber' : ''}
        data-tip={item.priority ? `GitHub Project priority: ${item.priority}` : 'Priority not set'}
      >
        {item.priority ?? 'P—'}
      </span>
      <span
        className="cc-size"
        data-tip={item.size ? `GitHub Project size: ${item.size}` : 'Size not set'}
      >
        {item.size ?? '—'}
      </span>
    </span>
  );
}
function Labels({ id }: { id: number }) {
  const labels = issueMetadata[id].labels;
  return (
    <span className="cc-labels">
      {labels.slice(0, 2).map((l) => (
        <span
          className="cc-label"
          key={l.name}
          data-tip={l.name}
          style={{
            color: `color-mix(in srgb, #${l.color} 45%, #dce9e4)`,
            borderColor: `#${l.color}66`,
            background: `#${l.color}18`,
          }}
        >
          {l.name}
        </span>
      ))}
      {labels.length > 2 && (
        <span className="cc-label-more" data-label-list={id}>
          +{labels.length - 2}
        </span>
      )}
    </span>
  );
}
function ParentTag({
  parent,
  nameKey,
  mode,
  expanded,
  highlighted,
}: {
  parent?: number;
  nameKey: string;
  mode: TitleMode;
  expanded: boolean;
  highlighted: boolean;
}) {
  return parent ? (
    <span
      className={`cc-parent-tag ${highlighted ? 'cc-parent-highlighted' : ''}`}
      data-tip={mode === 'expand' ? undefined : `Parent #${parent}: ${issueMetadata[parent].title}`}
      data-expand-title={mode === 'expand' ? nameKey : undefined}
      data-expanded={expanded}
    >
      <i className={parent === 644 ? 'cc-dot-green' : 'cc-dot-purple'} />
      <span>
        #{parent} {issueMetadata[parent].title}
      </span>
    </span>
  ) : (
    <span
      className="cc-parent-tag cc-empty-tag"
      data-tip="No parent issue"
      aria-label="No parent issue"
    >
      —
    </span>
  );
}
function Status({ status }: { status: string }) {
  const details: Record<string, string> = {
    Restacking: 'Restacking · simulated. Updating this PR onto its changed base branch.',
    Babysitting:
      'Babysitting · simulated factory stage. Watches CI after publication and starts repairs if applicable checks fail. Does not merge the PR.',
    'Repairing CI':
      'Repairing CI · simulated babysitting activity. The agent is fixing failed checks in its existing T3 thread; code changes are reviewed again.',
    Conflict: 'Conflict · simulated. This PR has merge conflicts with its base branch.',
    Ready:
      'Ready · simulated. For PRs, checks passed and the review is approved. For issues, ready for an agent.',
    'Needs review': 'Needs review · simulated. CI has passed; a human review is still needed.',
    'CI running': 'CI running · simulated. At least one required check is still in progress.',
    'CI failed': 'CI failed · simulated. At least one required check has failed.',
  };
  return (
    <span
      className={`cc-status ${statusAppearance(status).className} ${statusIsActive(status) ? 'cc-status-active' : ''}`}
      data-tip={details[status]}
    >
      {status}
      <i />
    </span>
  );
}
function StackSummary({ items, restacking }: { items: Item[]; restacking: boolean }) {
  const drafts = items.filter((i) => i.draft).length;
  const open = items.length - drafts;
  const summary = statusSummary(items, restacking);
  return (
    <>
      <span className="cc-pr-counts">
        <span
          className="cc-pr-count cc-green"
          aria-label={`Open PRs: ${open}`}
          data-tip={`${open} published open pull requests`}
        >
          <Icon kind="pr" size={12} />
          <span>{open}</span>
        </span>
        <span
          className="cc-pr-count cc-muted"
          aria-label={`Draft PRs: ${drafts}`}
          data-tip={`${drafts} draft pull requests`}
        >
          <Icon kind="draft-pr" size={12} />
          <span>{drafts}</span>
        </span>
      </span>
      <span
        className="cc-stack-summary"
        data-tip={summary.map((s) => `${s.count} ${s.status}`).join(' · ')}
      >
        {summary.map(({ status, count }) => (
          <span
            key={status}
            className={`${statusAppearance(status).className} ${statusIsActive(status) ? 'cc-status-active' : ''}`}
          >
            {count} {status}
          </span>
        ))}
      </span>
    </>
  );
}
export function FactoryCanvasPrototype() {
  const [scenario, setScenario] = useState<Scenario>(
    () =>
      scenarioChoices.find((s) => s.id === new URLSearchParams(location.search).get('scenario'))
        ?.id ?? 'varied'
  );
  const [titleMode, setTitleMode] = useState<TitleMode>(() =>
    new URLSearchParams(location.search).get('titles') === 'expand'
      ? 'expand'
      : new URLSearchParams(location.search).get('titles') === 'wrap'
        ? 'wrap'
        : 'ellipsis'
  );
  const [highlightStyle, setHighlightStyle] = useState<HighlightStyle>(() =>
    new URLSearchParams(location.search).get('highlight') === 'status-glow'
      ? 'status-glow'
      : new URLSearchParams(location.search).get('highlight') === 'status'
        ? 'status'
        : new URLSearchParams(location.search).get('highlight') === 'teal'
          ? 'teal'
          : new URLSearchParams(location.search).get('highlight') === 'slate'
            ? 'slate'
            : 'white'
  );
  const [reach, setReach] = useState<RelationshipMode>(() =>
    new URLSearchParams(location.search).get('reach') === 'all'
      ? 'all'
      : new URLSearchParams(location.search).get('reach') === 'transitive'
        ? 'transitive'
        : 'direct'
  );
  const [design, setDesign] = useState(false),
    [expandedNames, setExpandedNames] = useState<Set<string>>(new Set()),
    [hoverName, setHoverName] = useState<string>();
  const [hovered, setHovered] = useState<CanvasFocus>(),
    [locked, setLocked] = useState<CanvasFocus>();
  const [attentionOnly, setAttentionOnly] = useState(false);
  const [relationshipFilter, setRelationshipFilter] = useState<{
    instance: string;
    direction: Exclude<RelationshipDirection, 'both'>;
  }>();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const focus = attentionOnly ? undefined : (locked ?? hovered),
    active = focus?.id,
    direction =
      relationshipFilter?.instance === focus?.instance
        ? (relationshipFilter?.direction ?? 'both')
        : 'both';
  const [settings, setSettings] = useState(false),
    [threadTarget, setThreadTarget] = useState<'web' | 'native'>('web'),
    [paused, setPaused] = useState(false),
    [concurrency, setConcurrency] = useState(1),
    [allowance, setAllowance] = useState(1);
  const [restacking, setRestacking] = useState(true),
    [preview, setPreview] = useState(false),
    [start, setStart] = useState(false),
    [issue, setIssue] = useState(''),
    [context, setContext] = useState(''),
    [notice, setNotice] = useState('');
  const [cancelled, setCancelled] = useState<Set<number>>(new Set());
  const [pickedIssue, setPickedIssue] = useState<number>();
  const [tooltip, setTooltip] = useState<{
    text: string;
    x: number;
    y: number;
    above: boolean;
    labels?: number;
  }>();
  const tipAnchor = useRef<Element | null>(null);
  const data = useMemo(
    () => layout(scenario, { titleMode, expandedNames, hoverName, collapsed }),
    [scenario, titleMode, expandedNames, hoverName, collapsed]
  );
  const records = data.fixture.items;
  const attentionItems = records.filter(
    (item) => !cancelled.has(item.id) && requiresHumanAttention(item, restacking)
  );
  const attentionIds = new Set(attentionItems.map((item) => item.id));
  const allParents: Record<number, number> = { ...data.fixture.parentOf };
  for (const item of records) if (item.parent) allParents[item.id] = item.parent;
  const expandedName = (key: string) =>
    titleMode === 'expand' && (expandedNames.has(key) || hoverName === key);
  function setDesignValue(key: string, value: string) {
    const url = new URL(location.href);
    url.searchParams.set(key, value);
    history.replaceState(null, '', url);
  }
  function title(text: string, key: string, className = 'cc-title') {
    return (
      <span
        className={className}
        data-expanded={expandedName(key)}
        data-expand-title={titleMode === 'expand' ? key : undefined}
        data-tip={titleMode === 'expand' ? undefined : text}
      >
        {text}
      </span>
    );
  }
  const routes = useMemo(
    () =>
      routeCanvas(
        [
          ...data.boxes,
          ...data.headerNodes,
          ...data.aggregateNodes,
          ...data.groups
            .filter((g) => !g.parent)
            .map((g, i) => ({
              id: -4_000_000 - i,
              x: g.x,
              y: g.y,
              width: g.collapsed ? g.headingWidth : g.width,
              height: g.head,
            })),
          ...data.panels.map((p, i) => ({
            id: -500 - i,
            x: p.x,
            y: p.y,
            width: p.width,
            height: 32,
          })),
          ...data.areas.map((a, i) => ({
            id: -100 - i,
            x: 20,
            y: a.y - 10,
            width: 310,
            height: 20,
          })),
          ...[...data.groups, ...data.panels].flatMap((g, i) =>
            [
              [g.x, g.y],
              [g.x + g.width, g.y],
              [g.x, g.y + g.height],
              [g.x + g.width, g.y + g.height],
            ].map(([x, y], j) => ({ id: -1000 - i * 4 - j, x, y, width: 0, height: 0 }))
          ),
        ],
        data.routingConnections,
        data.width,
        data.height
      ),
    [data]
  );
  const { prerequisites, dependants, related, highlightedParents, activeEdges } =
    relationshipHighlights(
      active,
      data.connections,
      allParents,
      data.fixture.parentIds,
      reach,
      direction
    );
  const isActiveRoute = (r: { source: number; target: number }) =>
    data.routeRelationships
      .get(`${r.source}-${r.target}`)
      ?.some((e) => activeEdges.has(`${e.source}-${e.target}`)) ?? false;
  const [view, setView] = useState({ x: 12, y: 12, scale: 0.9 }),
    [dragging, setDragging] = useState(false);
  const viewport = useRef<HTMLDivElement>(null),
    drag = useRef<
      { id: number; x: number; y: number; vx: number; vy: number; moved: boolean } | undefined
    >(undefined);
  const suppressCanvasClick = useRef(false);
  function lock(id: number, instance = `item:${id}`) {
    setAttentionOnly(false);
    setRelationshipFilter(undefined);
    setLocked((current) => (current?.instance === instance ? undefined : { id, instance }));
  }
  function filterRelationships(next: Exclude<RelationshipDirection, 'both'>) {
    if (!focus) return;
    setLocked(focus);
    setRelationshipFilter(
      direction === next ? undefined : { instance: focus.instance, direction: next }
    );
  }
  function toggleAttention() {
    setAttentionOnly(!attentionOnly);
    setLocked(undefined);
    setHovered(undefined);
    setRelationshipFilter(undefined);
    setTooltip(undefined);
    if (attentionOnly) return;
    const keys = new Set(
      data.fixture.stackSpecs
        .filter((stack) => stack.ids.some((id) => attentionIds.has(id)))
        .map((stack) => `stack:${stack.key}`)
    );
    for (const item of attentionItems) {
      if (item.stage === 'review') continue;
      keys.add(`${item.stage}-${item.parent ?? 'none'}`);
      for (let parent = item.parent; parent !== undefined; parent = data.fixture.parentOf[parent])
        keys.add(`${item.stage}-${parent}`);
    }
    setCollapsed((current) => new Set([...current].filter((key) => !keys.has(key))));
  }
  function toggleCollapsed(key: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setTooltip(undefined);
  }
  function collapseAll() {
    setCollapsed(
      new Set([
        ...['planned', 'working'].flatMap((stage) =>
          [...data.fixture.parentIds, 'none'].map((id) => `${stage}-${id}`)
        ),
        ...data.fixture.stackSpecs.map((stack) => `stack:${stack.key}`),
      ])
    );
    setTooltip(undefined);
  }
  function sectionKeys(stage: Stage) {
    return stage === 'review'
      ? data.fixture.stackSpecs.map((s) => `stack:${s.key}`)
      : [...data.fixture.parentIds, 'none'].map((id) => `${stage}-${id}`);
  }
  function collapseSection(stage: Stage) {
    setCollapsed((current) => new Set([...current, ...sectionKeys(stage)]));
    setTooltip(undefined);
  }
  function expandSection(stage: Stage) {
    const keys = new Set(sectionKeys(stage));
    setCollapsed((current) => new Set([...current].filter((key) => !keys.has(key))));
    setTooltip(undefined);
  }
  function expandAll() {
    setCollapsed(new Set());
    setTooltip(undefined);
  }
  function changeScenario(value: Scenario) {
    setAttentionOnly(false);
    setScenario(value);
    setCollapsed(new Set());
    setExpandedNames(new Set());
    setHoverName(undefined);
    setPickedIssue(undefined);
    setIssue('');
    setView({ x: 12, y: 12, scale: 0.9 });
    setLocked(undefined);
    setHovered(undefined);
    setRelationshipFilter(undefined);
    setTooltip(undefined);
    const url = new URL(location.href);
    url.searchParams.set('scenario', value);
    url.searchParams.delete('expanded');
    history.replaceState(null, '', url);
  }
  function fit(rect?: { x: number; y: number; width: number; height: number }) {
    const box = viewport.current?.getBoundingClientRect();
    if (!box) return;
    const r = rect ?? { x: 0, y: 0, width: data.width, height: data.height };
    const scale = Math.min(
      1,
      (box.width - 60) / (r.width + 40),
      (box.height - 110) / (r.height + 40)
    );
    setView({ scale, x: (box.width - r.width * scale) / 2 - r.x * scale, y: 20 - r.y * scale });
  }
  function fitActive() {
    const ns = [...data.boxes, ...data.headerNodes].filter((n) => related.has(n.id));
    if (!ns.length) return;
    const x = Math.min(...ns.map((n) => n.x)),
      y = Math.min(...ns.map((n) => n.y));
    fit({
      x: x - 20,
      y: y - 20,
      width: Math.max(...ns.map((n) => n.x + n.width)) - x + 40,
      height: Math.max(...ns.map((n) => n.y + n.height)) - y + 40,
    });
  }
  function jump(stage: Stage) {
    const area = data.areas.find((a) => a.id === stage);
    if (area) setView((v) => ({ ...v, x: 12, y: 20 - area.y * v.scale }));
  }
  function zoom(factor: number, p?: { x: number; y: number }) {
    const el = viewport.current;
    if (!el) return;
    const point = p ?? { x: el.clientWidth / 2, y: el.clientHeight / 2 };
    setView((v) => {
      const scale = Math.min(1.8, Math.max(0.02, v.scale * factor));
      return {
        scale,
        x: point.x - ((point.x - v.x) * scale) / v.scale,
        y: point.y - ((point.y - v.y) * scale) / v.scale,
      };
    });
  }
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      if ((event.target as Element).closest('.cc-controls,.cc-minimap,.cc-selection')) return;
      event.preventDefault();
      setTooltip(undefined);
      if (event.ctrlKey || event.metaKey || (!event.shiftKey && Math.abs(event.deltaX) < 1)) {
        const rect = el.getBoundingClientRect();
        zoom(Math.exp(-event.deltaY * 0.002), {
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
        });
      } else
        setView((v) => ({
          ...v,
          x: v.x - (event.shiftKey ? event.deltaY : event.deltaX),
          y: v.y - (event.shiftKey ? 0 : event.deltaY),
        }));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);
  useEffect(() => {
    if (new URLSearchParams(location.search).get('focus') === 'review') {
      const area = data.areas.find((a) => a.id === 'review');
      if (area) setView((v) => ({ ...v, y: 20 - area.y * v.scale }));
    }
  }, []);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setAttentionOnly(false);
        setLocked(undefined);
        setHovered(undefined);
        setRelationshipFilter(undefined);
        setSettings(false);
        setDesign(false);
        setPreview(false);
        setStart(false);
        setTooltip(undefined);
      }
      if ((event.target as Element).closest('input,textarea,select,button,a')) return;
      if (event.key.toLowerCase() === 'f') {
        event.preventDefault();
        fit();
      }
      if (event.key === '+' || event.key === '=') {
        event.preventDefault();
        zoom(1.2);
      }
      if (event.key === '-') {
        event.preventDefault();
        zoom(1 / 1.2);
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });
  function pointerDown(e: Pointer<HTMLDivElement>) {
    if (
      (e.target as Element).closest(
        '.cc-item,.cc-parent-head,.cc-selection,button,a,input,select,textarea,.cc-minimap'
      ) ||
      e.button !== 0
    )
      return;
    suppressCanvasClick.current = false;
    drag.current = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      vx: view.x,
      vy: view.y,
      moved: false,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function pointerMove(e: Pointer<HTMLDivElement>) {
    const d = drag.current;
    if (d && d.id === e.pointerId) {
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) d.moved = true;
      if (!d.moved) return;
      setDragging(true);
      setView((v) => ({ ...v, x: d.vx + e.clientX - d.x, y: d.vy + e.clientY - d.y }));
    }
  }
  function endDrag() {
    if (drag.current) suppressCanvasClick.current = drag.current.moved;
    drag.current = undefined;
    setDragging(false);
  }
  function showTip(event: Pointer<HTMLDivElement>) {
    const name =
      (event.target as Element).closest('[data-expand-title]')?.getAttribute('data-expand-title') ??
      undefined;
    if (titleMode === 'expand') setHoverName((current) => (current === name ? current : name));
    const anchor = (event.target as Element).closest('[data-tip],[data-label-list]');
    if (anchor === tipAnchor.current) return;
    tipAnchor.current = anchor;
    if (!anchor) {
      setTooltip(undefined);
      return;
    }
    const labelId = anchor.getAttribute('data-label-list');
    const text = labelId ? 'Labels' : anchor.getAttribute('data-tip');
    if (!text) return;
    const r = anchor.getBoundingClientRect();
    setTooltip({
      text,
      x: Math.max(8, Math.min(window.innerWidth - 368, r.left)),
      y: r.bottom + 7,
      above: r.bottom > window.innerHeight - 110,
      labels: labelId ? Number(labelId) : undefined,
    });
  }
  function threadLink(item: Item) {
    if (item.synthetic && (item.stage === 'working' || item.stage === 'review'))
      return (
        <button
          type="button"
          className="cc-thread"
          aria-label={`Open simulated T3 thread for #${item.id}`}
          data-tip="Synthetic T3 action. No real thread is associated with this fixture."
          onClick={() =>
            setNotice(`Synthetic T3 thread for #${item.id} · simulated navigation only`)
          }
        >
          T3 ↗
        </button>
      );
    if (!item.thread) return null;
    const path = `${encodeURIComponent('65a55dad-0df9-496d-bdad-21a139b9456d')}/${encodeURIComponent(item.thread)}`;
    return (
      <a
        className="cc-thread"
        href={
          threadTarget === 'native' ? `t3code://threads/${path}` : `https://app.t3.codes/${path}`
        }
        target={threadTarget === 'web' ? '_blank' : undefined}
        rel="noreferrer"
        data-tip={`Open evidenced T3 thread in ${threadTarget === 'web' ? 'browser' : 'native app'}`}
      >
        T3 ↗
      </a>
    );
  }
  function attributes(id: number, instance = `item:${id}`) {
    return {
      'data-card': id,
      'data-focus-instance': instance,
      tabIndex: 0,
      role: 'group',
      'aria-label': `Highlight relationships for #${id}`,
      onPointerEnter: () => setHovered({ id, instance }),
      onPointerLeave: () =>
        setHovered((current) => (current?.instance === instance ? undefined : current)),
      onFocus: () => setHovered({ id, instance }),
      onBlur: () => setHovered((current) => (current?.instance === instance ? undefined : current)),
      onClick: (e: React.MouseEvent) => {
        if (!(e.target as Element).closest('a,button')) {
          const key = (e.target as Element)
            .closest('[data-expand-title]')
            ?.getAttribute('data-expand-title');
          if (key && titleMode === 'expand')
            setExpandedNames((current) => {
              const next = new Set(current);
              if (next.has(key)) next.delete(key);
              else next.add(key);
              return next;
            });
          lock(id, instance);
        }
      },
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          lock(id, instance);
        }
      },
    };
  }
  function itemCard(box: Box) {
    const { item } = box,
      meta = issueMetadata[item.id],
      itemStatus = cancelled.has(item.id) ? 'Cancelled' : displayStatus(item, restacking),
      isActive = active === item.id,
      isHighlighted = attentionOnly ? attentionIds.has(item.id) : isActive,
      connected = attentionOnly ? attentionIds.has(item.id) : related.has(item.id),
      isRelated = !attentionOnly && active !== undefined && connected && !isActive,
      edge = routes.find(
        (r) =>
          isActiveRoute(r) &&
          data.routeRelationships
            .get(`${r.source}-${r.target}`)
            ?.some((e) => e.source === item.id || e.target === item.id)
      );
    return (
      <div
        key={item.id}
        {...attributes(item.id)}
        className={`cc-item ${item.pr ? `cc-pr-row ${box.stacked ? '' : 'cc-solo-pr'}` : 'cc-issue-card'} ${statusIsActive(itemStatus) ? 'cc-active-job' : ''} ${isHighlighted ? 'cc-selected' : ''} ${isRelated ? 'cc-related' : ''} ${(attentionOnly || active !== undefined) && !connected ? 'cc-dimmed' : ''} ${cancelled.has(item.id) ? 'cc-cancelled' : ''}`}
        style={
          {
            left: box.x,
            top: box.y,
            width: box.width,
            height: box.height,
            borderColor:
              isHighlighted && statusIsActive(itemStatus)
                ? undefined
                : (item.pr && isHighlighted) || (attentionOnly && connected)
                  ? highlightStyle === 'status' || highlightStyle === 'status-glow'
                    ? statusAppearance(itemStatus).color
                    : undefined
                  : active !== undefined && connected
                    ? highlightStyle === 'status' || highlightStyle === 'status-glow'
                      ? statusAppearance(itemStatus).color
                      : edge?.color
                    : undefined,
            '--cc-status-color': statusAppearance(itemStatus).color,
          } as CSSProperties
        }
      >
        {item.pr ? (
          <>
            <div className="cc-pr-top">
              <Identity item={item} />
              {threadLink(item)}
              {title(meta.title, `issue:${item.id}`)}
              <Status status={itemStatus} />
              <Fields id={item.id} />
            </div>
            <div className="cc-pr-bottom">
              <Labels id={item.id} />
              <ParentTag
                parent={item.parent}
                nameKey={`badge:${item.id}`}
                mode={titleMode}
                expanded={expandedName(`badge:${item.id}`)}
                highlighted={!!item.parent && highlightedParents.has(item.parent)}
              />
              <span className="cc-evidence">
                <span className="cc-checks">
                  {item.checks?.map((state, index) => (
                    <span
                      key={checkNames[index]}
                      className={`cc-check ${state}`}
                      data-tip={`${checkNames[index]} · ${state}`}
                      tabIndex={0}
                    >
                      <Icon kind={state} />
                    </span>
                  ))}
                </span>
                <span
                  className="cc-reviewer"
                  data-tip={
                    item.approved
                      ? 'Rafael · Approved · simulated review'
                      : 'Rafael · Review requested · simulated review'
                  }
                >
                  <img src={reviewer} width="18" height="18" alt="Rafael" />
                  <b className={item.approved ? 'approved' : 'requested'}>
                    {item.approved ? '✓' : '·'}
                  </b>
                </span>
              </span>
            </div>
          </>
        ) : (
          <>
            <div className="cc-issue-top">
              <Identity item={item} />
              {threadLink(item)}
              <Status status={itemStatus} />
              <Fields id={item.id} />
            </div>
            {title(meta.title, `issue:${item.id}`)}
            {!!meta.labels.length && (
              <div className="cc-issue-bottom">
                <Labels id={item.id} />
              </div>
            )}
          </>
        )}
      </div>
    );
  }
  const searchPool = data.fixture.synthetic
    ? records.map((i) => issueMetadata[i.id])
    : [
        ...new Map(
          [...Object.values(baseMetadata), ...searchSnapshot].map((m) => [m.number, m])
        ).values(),
      ];
  const searchMatches = searchPool.filter((m) =>
    `${m.number} ${m.title}`.toLowerCase().includes(issue.replace(/^#/, '').toLowerCase())
  );
  const activeGroup = data.groups.find((g) => g.key === focus?.instance);
  const activeRecord = records.find((i) => i.id === active),
    incident = routes.filter(isActiveRoute);
  return (
    <div
      className={`cc-app cc-titles-${titleMode} cc-highlight-${highlightStyle}`}
      style={{ '--cc-label-column': `${data.labelColumn}px` } as React.CSSProperties}
      onPointerMove={showTip}
      onPointerLeave={() => {
        tipAnchor.current = null;
        setTooltip(undefined);
        setHoverName(undefined);
      }}
      onClick={(e) => {
        if (
          !suppressCanvasClick.current &&
          !(e.target as Element).closest(
            '.cc-item,.cc-parent-head,.cc-selection,button,a,input,select,textarea,.cc-minimap'
          )
        ) {
          setAttentionOnly(false);
          setLocked(undefined);
          setHovered(undefined);
          setRelationshipFilter(undefined);
        }
        suppressCanvasClick.current = false;
      }}
    >
      <header className="cc-toolbar">
        <strong>Factory</strong>
        <span
          className={`cc-runtime ${paused ? 'cc-amber' : 'cc-green'}`}
          data-tip={
            paused
              ? 'New admissions are paused. Existing jobs continue.'
              : 'The factory can accept eligible work within its concurrency and admission limits.'
          }
        >
          <i />
          {paused ? 'Paused' : 'Running'}
        </span>
        <button
          type="button"
          className="cc-attention-toggle"
          aria-label={`Highlight ${attentionIds.size} items needing human attention`}
          aria-pressed={attentionOnly}
          disabled={attentionIds.size === 0 && !attentionOnly}
          data-tip="Needs review and Manual recovery need human action. Conflicts and failed CI can be recovered automatically unless they escalate to manual recovery."
          onClick={toggleAttention}
        >
          <Icon kind="attention" size={13} />
          <span className="cc-attention-count">{attentionIds.size}</span> need attention
        </button>
        <span
          className="cc-fixture"
          data-tip="Real GitHub issue titles, labels, priority and size. Workflow states, parent membership, dependencies, stacks, reviews and controls are simulated."
        >
          {data.fixture.synthetic
            ? `Synthetic · ${records.length} issues`
            : 'Mock workflow · GitHub metadata'}
        </span>
        <span className="cc-toolbar-space" />
        <select
          aria-label="Fixture scenario"
          value={scenario}
          onChange={(e) =>
            changeScenario(scenarioChoices.find((s) => s.id === e.target.value)?.id ?? 'varied')
          }
        >
          {scenarioChoices.map((s) => (
            <option value={s.id} key={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          aria-label="Design variants"
          onClick={() => {
            setDesign(!design);
            setSettings(false);
          }}
        >
          Design
        </button>
        <button
          type="button"
          data-tip="Propose and validate a plan without starting implementation. This prototype shows an example selection only."
          onClick={() => {
            setPreview(!preview);
            setDesign(false);
            setSettings(false);
            setStart(false);
          }}
        >
          ◇ Preview plan
        </button>
        <button
          type="button"
          onClick={() => {
            setStart(!start);
            setDesign(false);
            setIssue('');
            setSettings(false);
            setPreview(false);
          }}
        >
          + Start issue
        </button>
        <button
          type="button"
          data-tip={
            paused
              ? 'Allow the factory to accept eligible work again.'
              : 'Stop the factory from accepting more work temporarily. Existing jobs continue.'
          }
          onClick={() => setPaused(!paused)}
        >
          {paused ? '▶ Resume' : 'Ⅱ Pause'}
        </button>
        <button
          type="button"
          className="cc-settings-button"
          aria-label="Factory settings"
          onClick={() => {
            setSettings(!settings);
            setDesign(false);
            setStart(false);
            setPreview(false);
          }}
        >
          <Icon kind="gear" size={18} />
        </button>
      </header>
      <div
        className={`cc-viewport ${dragging ? 'dragging' : ''}`}
        ref={viewport}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
      >
        <div
          className="cc-world"
          style={{
            width: data.width,
            height: data.height,
            transform: `translate(${view.x}px,${view.y}px) scale(${view.scale})`,
          }}
        >
          {data.areas.map((area) => (
            <section
              className="cc-area"
              data-area={area.id}
              key={area.id}
              style={{ left: 16, top: area.y, width: area.width - 16, height: area.height }}
            >
              <h2>
                <i className={`cc-stage-dot ${area.id}`} />
                {area.name}
                <span>{records.filter((i) => i.stage === area.id).length}</span>
                <button
                  type="button"
                  aria-label={`Collapse all ${area.name}`}
                  onClick={() => collapseSection(area.id)}
                >
                  <Icon kind="collapse" size={12} />
                  Collapse all
                </button>
                <button
                  type="button"
                  aria-label={`Expand all ${area.name}`}
                  onClick={() => expandSection(area.id)}
                >
                  <Icon kind="expand" size={12} />
                  Expand all
                </button>
              </h2>
            </section>
          ))}
          {data.groups.map((group) => (
            <section
              className={`cc-parent-group ${group.parent ? '' : 'cc-unparented'} ${group.collapsed ? 'cc-collapsed' : ''} ${highlightedParents.has(group.parent ?? -1) ? 'cc-group-selected' : ''}`}
              key={group.key}
              data-group={group.key}
              style={
                {
                  left: group.x,
                  top: group.y,
                  width: group.width,
                  height: group.height,
                  zIndex: 1 + group.depth * 0.1,
                  '--cc-parent-accent': group.parent === 644 ? '#62bea0' : '#b19ad8',
                  borderColor: highlightedParents.has(group.parent ?? -1)
                    ? routes.find(
                        (r) =>
                          (r.source === active && r.target === group.parent) ||
                          (r.target === active && r.source === group.parent)
                      )?.color
                    : undefined,
                } as CSSProperties
              }
            >
              {group.parent ? (
                <div
                  {...attributes(group.parent, group.key)}
                  className={`cc-parent-head ${focus?.instance === group.key ? 'cc-parent-focused' : ''}`}
                  style={{ height: group.head - (group.collapsed ? 2 : 0) }}
                >
                  <button
                    type="button"
                    className={`cc-collapse ${group.collapsed ? '' : 'cc-expanded'}`}
                    aria-label={`${group.collapsed ? 'Expand' : 'Collapse'} parent #${group.parent} in ${stages.find((s) => s.id === group.stage)?.name}`}
                    aria-expanded={!group.collapsed}
                    onClick={() => toggleCollapsed(group.key)}
                  >
                    <Icon kind={group.collapsed ? 'expand' : 'collapse'} size={14} />
                  </button>
                  <i className={group.parent === 644 ? 'cc-dot-green' : 'cc-dot-purple'} />
                  <span className="cc-heading-text cc-parent-copy">
                    {issueMetadata[group.parent].url ? (
                      <a
                        className="cc-parent-number"
                        href={issueMetadata[group.parent].url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        #{group.parent}
                      </a>
                    ) : (
                      <span
                        className="cc-synthetic-number cc-parent-number"
                        data-tip="Synthetic parent; no GitHub issue"
                      >
                        #{group.parent}
                      </span>
                    )}
                    {title(
                      issueMetadata[group.parent].title,
                      `parent:${group.stage}:${group.parent}`,
                      'cc-parent-name'
                    )}
                    <span className="cc-group-count">{group.ids.length}</span>
                  </span>
                </div>
              ) : (
                <div
                  className="cc-parent-head cc-no-parent-heading"
                  style={{
                    height: group.head,
                    width: group.collapsed ? group.headingWidth : undefined,
                  }}
                >
                  <button
                    type="button"
                    className={`cc-collapse ${group.collapsed ? '' : 'cc-expanded'}`}
                    aria-label={`${group.collapsed ? 'Expand' : 'Collapse'} unparented issues in ${stages.find((s) => s.id === group.stage)?.name}`}
                    aria-expanded={!group.collapsed}
                    onClick={() => toggleCollapsed(group.key)}
                  >
                    <Icon kind={group.collapsed ? 'expand' : 'collapse'} size={14} />
                  </button>
                  <span className="cc-heading-text cc-unparented-copy">
                    <span>Unparented issues</span>
                    <span className="cc-group-count">{group.ids.length}</span>
                  </span>
                </div>
              )}
            </section>
          ))}
          {data.panels.map((panel) => (
            <section
              key={panel.key}
              className={`cc-pr-panel ${panel.stacked ? 'cc-stacked' : 'cc-independent'} ${panel.collapsed ? 'cc-collapsed' : ''}`}
              data-stack={panel.key}
              style={
                {
                  left: panel.x,
                  top: panel.y,
                  width: panel.width,
                  height: panel.height,
                } as CSSProperties
              }
            >
              <div className="cc-panel-title">
                <button
                  type="button"
                  className={`cc-collapse ${panel.collapsed ? '' : 'cc-expanded'}`}
                  aria-label={`${panel.collapsed ? 'Expand' : 'Collapse'} ${panel.stacked ? 'stack' : 'independent PRs'} ${panel.key}`}
                  aria-expanded={!panel.collapsed}
                  onClick={() => toggleCollapsed(`stack:${panel.key}`)}
                >
                  <Icon kind={panel.collapsed ? 'expand' : 'collapse'} size={14} />
                </button>

                <span className="cc-stack-heading">
                  {!panel.stacked && panel.name}
                  <StackSummary
                    items={records.filter((i) => panel.ids.includes(i.id))}
                    restacking={restacking}
                  />
                  {panel.stacked && !panel.collapsed && (
                    <span className="cc-base-direction">tip ↑ · base ↓</span>
                  )}
                </span>
              </div>
            </section>
          ))}
          <svg className="cc-lines" width={data.width} height={data.height} aria-hidden="true">
            <defs>
              {routes.map((r) => (
                <marker
                  id={`cc-arrow-${r.key}`}
                  key={r.key}
                  viewBox="0 0 10 10"
                  refX="8"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto-start-reverse"
                >
                  <path d="m2 2 6 3-6 3" fill="none" stroke={r.color} strokeWidth="1.8" />
                </marker>
              ))}
            </defs>
            {[...routes]
              .sort((a, b) => Number(isActiveRoute(a)) - Number(isActiveRoute(b)))
              .map((r) => (
                <g
                  key={r.key}
                  className={attentionOnly || active ? (isActiveRoute(r) ? 'active' : 'muted') : ''}
                >
                  <path className="cc-line-halo" d={r.d} />
                  <path
                    className="cc-line"
                    data-edge={r.key}
                    data-points={JSON.stringify(r.points)}
                    data-failed={r.failed}
                    d={r.d}
                    stroke={r.color}
                    markerStart={`url(#cc-arrow-${r.key})`}
                  />
                </g>
              ))}
          </svg>
          {data.boxes.map(itemCard)}
          <svg className="cc-endpoints" width={data.width} height={data.height} aria-hidden="true">
            {incident.flatMap((r) =>
              [r.points[0], r.points[r.points.length - 1]].map((p, index) => (
                <g key={`${r.key}-${index}`} transform={`translate(${p.x},${p.y})`}>
                  <circle r="3" fill="#111117" stroke={r.color} strokeWidth="1.5" />
                </g>
              ))
            )}
          </svg>
        </div>
        <nav className="cc-controls" aria-label="Canvas navigation">
          <button type="button" aria-label="Collapse all sections" onClick={collapseAll}>
            <Icon kind="collapse" size={13} />
            Collapse all
          </button>
          <button type="button" aria-label="Expand all sections" onClick={expandAll}>
            <Icon kind="expand" size={13} />
            Expand all
          </button>
          <i />
          {stages.map((s) => (
            <button type="button" key={s.id} onClick={() => jump(s.id)}>
              {s.name}
            </button>
          ))}
          <i />
          <button type="button" aria-label="Zoom out" onClick={() => zoom(1 / 1.2)}>
            −
          </button>
          <span>{Math.round(view.scale * 100)}%</span>
          <button type="button" aria-label="Zoom in" onClick={() => zoom(1.2)}>
            +
          </button>
          <button type="button" aria-label="Fit all nodes" onClick={() => fit()}>
            <Icon kind="fit" />
          </button>
        </nav>
        {active && (
          <div className="cc-selection" role="toolbar" aria-label="Selected item actions">
            <div className="cc-selection-content">
              <strong className="cc-selection-identity">
                {activeRecord ? (
                  <Identity item={activeRecord} />
                ) : issueMetadata[active]?.url ? (
                  <a href={issueMetadata[active].url} target="_blank" rel="noreferrer">
                    #{active}
                  </a>
                ) : (
                  <span data-tip="Synthetic parent; no GitHub issue">#{active}</span>
                )}
              </strong>
              {activeRecord && threadLink(activeRecord)}
              {activeGroup && <span>{stages.find((s) => s.id === activeGroup.stage)?.name}</span>}
              <button
                type="button"
                className="cc-relationship-filter"
                aria-label="Highlight prerequisites"
                aria-pressed={direction === 'prerequisites'}
                data-tip="Highlight only prerequisites. Click again to show both directions."
                onClick={() => filterRelationships('prerequisites')}
              >
                {prerequisites.size} prerequisites
              </button>
              <button
                type="button"
                className="cc-relationship-filter"
                aria-label="Highlight dependants"
                aria-pressed={direction === 'dependants'}
                data-tip="Highlight only dependants. Click again to show both directions."
                onClick={() => filterRelationships('dependants')}
              >
                {dependants.size} dependants
              </button>
            </div>
            <div className="cc-selection-actions">
              <button
                type="button"
                aria-label="Fit connections"
                data-tip="Fit highlighted connections"
                onClick={fitActive}
              >
                <Icon kind="eye" />
              </button>
              {activeRecord?.stage === 'working' && (
                <>
                  <button
                    type="button"
                    className="cc-action-resume"
                    aria-label="Resume"
                    data-tip="Resume job · simulated"
                    onClick={() => setNotice(`Resume #${active} · simulated only`)}
                  >
                    <Icon kind="play" />
                  </button>
                  <button
                    type="button"
                    className="cc-action-cancel"
                    aria-label="Cancel job"
                    data-tip="Cancel job · simulated"
                    onClick={() => {
                      setCancelled((c) => new Set([...c, active]));
                      setNotice(`Cancel #${active} · simulated only`);
                    }}
                  >
                    <Icon kind="stop" />
                  </button>
                </>
              )}
            </div>
          </div>
        )}
        <svg
          className="cc-minimap"
          viewBox={`0 0 ${data.width} ${data.height}`}
          preserveAspectRatio="none"
          style={{ width: 144, height: Math.min(160, (144 * data.height) / data.width) }}
          aria-label="Canvas minimap"
          onPointerDown={(e) => {
            e.stopPropagation();
            const r = e.currentTarget.getBoundingClientRect(),
              x = ((e.clientX - r.left) / r.width) * data.width,
              y = ((e.clientY - r.top) / r.height) * data.height;
            const el = viewport.current;
            if (el)
              setView((v) => ({
                ...v,
                x: el.clientWidth / 2 - x * v.scale,
                y: el.clientHeight / 2 - y * v.scale,
              }));
          }}
        >
          {data.areas.map((a) => (
            <rect
              key={a.id}
              className="cc-map-area"
              x="16"
              y={a.y}
              width={a.width - 32}
              height={a.height}
            />
          ))}
          {data.boxes.map((b) => (
            <rect
              className={`cc-map-card ${b.item.stage}`}
              key={b.id}
              x={b.x}
              y={b.y}
              width={b.width}
              height={b.height}
            />
          ))}
          <rect
            className="cc-map-view"
            x={-view.x / view.scale}
            y={-view.y / view.scale}
            width={(viewport.current?.clientWidth ?? 1280) / view.scale}
            height={(viewport.current?.clientHeight ?? 800) / view.scale}
          />
        </svg>
      </div>
      {design && (
        <section className="cc-floating cc-design" aria-label="Design variants">
          <div className="cc-floating-title">
            <strong>Design variants</strong>
            <button
              type="button"
              aria-label="Close design variants"
              onClick={() => setDesign(false)}
            >
              ×
            </button>
          </div>
          <label>
            Highlight style
            <select
              aria-label="Highlight style"
              value={highlightStyle}
              onChange={(e) => {
                const v =
                  e.target.value === 'status-glow'
                    ? 'status-glow'
                    : e.target.value === 'status'
                      ? 'status'
                      : e.target.value === 'slate'
                        ? 'slate'
                        : e.target.value === 'teal'
                          ? 'teal'
                          : 'white';
                setHighlightStyle(v);
                setDesignValue('highlight', v);
              }}
            >
              <option value="white">White outline</option>
              <option value="status">Status outline</option>
              <option value="status-glow">Status glow</option>
              <option value="slate">Slate wash</option>
              <option value="teal">Teal glow</option>
            </select>
          </label>
        </section>
      )}
      {settings && (
        <section className="cc-floating cc-settings" aria-label="Factory settings">
          <div className="cc-floating-title">
            <strong>Settings</strong>
            <button type="button" aria-label="Close settings" onClick={() => setSettings(false)}>
              ×
            </button>
          </div>
          <label>
            Long names
            <select
              aria-label="Long name behavior"
              value={titleMode}
              onChange={(e) => {
                const v =
                  e.target.value === 'wrap'
                    ? 'wrap'
                    : e.target.value === 'expand'
                      ? 'expand'
                      : 'ellipsis';
                setTitleMode(v);
                setHoverName(undefined);
                setExpandedNames(new Set());
                setDesignValue('titles', v);
              }}
            >
              <option value="wrap">Wrap</option>
              <option value="ellipsis">Ellipsis + tooltip</option>
              <option value="expand">Expand in place</option>
            </select>
          </label>
          <label>
            Relationships
            <select
              aria-label="Relationship depth"
              value={reach}
              onChange={(e) => {
                const v =
                  e.target.value === 'all'
                    ? 'all'
                    : e.target.value === 'transitive'
                      ? 'transitive'
                      : 'direct';
                setReach(v);
                setDesignValue('reach', v);
              }}
            >
              <option value="direct">Direct only</option>
              <option value="transitive">Transitive, no parent highlight</option>
              <option value="all">Transitive + parents</option>
            </select>
          </label>
          <label>
            T3 links
            <select
              aria-label="T3 link destination"
              value={threadTarget}
              onChange={(e) => setThreadTarget(e.target.value === 'native' ? 'native' : 'web')}
            >
              <option value="web">Website</option>
              <option value="native">Native app</option>
            </select>
          </label>
          <label>
            Concurrent jobs
            <input
              type="number"
              min="1"
              value={concurrency}
              onChange={(e) => setConcurrency(Math.max(1, +e.target.value))}
            />
          </label>
          <label>
            Distinct issue allowance
            <input
              type="number"
              min="-1"
              value={allowance}
              onChange={(e) => setAllowance(Math.max(-1, +e.target.value))}
            />
          </label>
          <small>Use −1 for unlimited admissions.</small>
          <label>
            Pause new admissions
            <input type="checkbox" checked={paused} onChange={(e) => setPaused(e.target.checked)} />
          </label>
          <label>
            Restacking example
            <input
              aria-label="Restacking example"
              type="checkbox"
              checked={restacking}
              onChange={(e) => setRestacking(e.target.checked)}
            />
          </label>
          <button
            type="button"
            className="cc-primary"
            onClick={() => {
              setSettings(false);
              setNotice('Settings applied locally · live factory unchanged');
            }}
          >
            Apply locally
          </button>
          <small>Prototype controls reset on reload.</small>
        </section>
      )}
      {preview && (
        <section className="cc-floating cc-plan">
          <div className="cc-floating-title">
            <strong>Plan preview · simulated</strong>
            <button type="button" aria-label="Close plan preview" onClick={() => setPreview(false)}>
              ×
            </button>
          </div>
          <p className="cc-explanation">
            A plan preview suggests which eligible issues could run next, their order, and why. It
            does not admit work or start agents.
          </p>
          <div className="cc-plan-outcome">Example proposal · validated selection</div>
          {records
            .filter((i) => i.stage === 'planned' && !i.deps.length)
            .slice(0, allowance === -1 ? undefined : allowance)
            .map((i) => (
              <div className="cc-plan-item" key={i.id}>
                <Identity item={i} />
                <div>
                  <span>{issueMetadata[i.id].title}</span>
                  <small>
                    No unresolved dependencies in this example; selected within the admission
                    allowance.
                  </small>
                </div>
              </div>
            ))}
          <small>
            These rows are a simulated proposal, limited by the example allowance. A real preview
            rechecks freshness and may reject issues. No planner was called or work dispatched.
          </small>
        </section>
      )}
      {start && (
        <form
          className="cc-floating cc-start"
          onSubmit={(e) => {
            e.preventDefault();
            if (!pickedIssue) return;
            setNotice(`Start issue #${pickedIssue} · simulated only`);
            setStart(false);
          }}
        >
          <div className="cc-floating-title">
            <strong>Start issue · simulated</strong>
            <button type="button" aria-label="Close start issue" onClick={() => setStart(false)}>
              ×
            </button>
          </div>
          <label className="cc-textarea-label">
            Find an issue
            <input
              aria-label="Search issues by title or number"
              type="search"
              placeholder="Title or #number…"
              value={issue}
              onChange={(e) => {
                setIssue(e.target.value);
                setPickedIssue(undefined);
              }}
            />
          </label>
          <div className="cc-search-results" role="listbox" aria-label="Matching issues">
            {searchMatches.slice(0, 10).map((m) => (
              <button
                type="button"
                role="option"
                aria-selected={pickedIssue === m.number}
                key={m.number}
                onClick={() => setPickedIssue(m.number)}
              >
                <span>#{m.number}</span>
                <span>{m.title}</span>
                {pickedIssue === m.number && <b>✓</b>}
              </button>
            ))}
          </div>
          {!searchMatches.length && <small>No matches in this prototype snapshot.</small>}
          <small>
            Manual start is supported by the factory. Eligibility, pause state, capacity and
            existing reservations are checked before admission.
          </small>
          <label className="cc-textarea-label">
            Execution context
            <textarea value={context} onChange={(e) => setContext(e.target.value)} />
          </label>
          <button className="cc-primary" type="submit" disabled={!pickedIssue}>
            {pickedIssue ? `Simulate start #${pickedIssue}` : 'Select an issue'}
          </button>
        </form>
      )}
      {notice && (
        <div className="cc-notice" role="status">
          {notice}
          <button type="button" aria-label="Dismiss notification" onClick={() => setNotice('')}>
            ×
          </button>
        </div>
      )}
      {tooltip && (
        <div
          className="cc-tooltip"
          role="tooltip"
          style={{
            left: tooltip.x,
            top: tooltip.above ? undefined : tooltip.y,
            bottom: tooltip.above ? window.innerHeight - tooltip.y + 20 : undefined,
          }}
        >
          {tooltip.labels ? (
            <>
              <strong>Labels</strong>
              <div className="cc-tooltip-labels">
                {issueMetadata[tooltip.labels].labels.map((l) => (
                  <span
                    className="cc-label"
                    key={l.name}
                    style={{
                      color: `color-mix(in srgb,#${l.color} 45%,#edf2ef)`,
                      borderColor: `#${l.color}80`,
                      background: `#${l.color}25`,
                    }}
                  >
                    {l.name}
                  </span>
                ))}
              </div>
            </>
          ) : (
            tooltip.text
          )}
        </div>
      )}
    </div>
  );
}
