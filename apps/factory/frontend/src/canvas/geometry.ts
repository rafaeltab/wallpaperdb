// Packing and text metrics preserved from the selected canvas prototype.
import type { CanvasData, CanvasItem as Item } from './view-model';
import type {
  Box,
  Group,
  Panel,
  StackRow,
  LayoutOptions,
  RelationshipMode,
  RelationshipDirection,
  Stage,
} from './geometry-types';
import type { Edge, Rect } from './routing';
export const stages: { id: Stage; name: string }[] = [
  { id: 'planned', name: 'Planned' },
  { id: 'working', name: 'Working' },
  { id: 'review', name: 'In review' },
  { id: 'unclassified', name: 'Unclassified' },
];
const CARD_W = 384,
  PR_W = 768,
  PR_H = 56;
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
function arrangeIssues(
  members: Item[],
  connections: Edge[],
  heightOf: (item: Item) => number,
  issueMetadata: CanvasData['metadata']
) {
  const localIds = new Set(members.map((i) => i.id));
  const localEdges = connections.filter((e) => localIds.has(e.source) && localIds.has(e.target));
  const connected = new Set(connections.flatMap((e) => [e.source, e.target]));
  // Unavailable project data precedes known ranks, including known unmarked fields.
  const compare = (a: Item, b: Item) =>
    Number(issueMetadata[a.id].projectKnown) - Number(issueMetadata[b.id].projectKnown) ||
    (issueMetadata[a.id].priorityRank ?? Infinity) -
      (issueMetadata[b.id].priorityRank ?? Infinity) ||
    (issueMetadata[a.id].sizeRank ?? Infinity) - (issueMetadata[b.id].sizeRank ?? Infinity) ||
    (issueMetadata[a.id].number ?? Infinity) - (issueMetadata[b.id].number ?? Infinity) ||
    a.id - b.id;
  const unseen = new Set(localIds),
    components: Item[][] = [];
  while (unseen.size) {
    const first = unseen.values().next().value;
    if (first === undefined) break;
    const queue = [first],
      ids = new Set<number>();
    while (queue.length) {
      const id = queue.pop();
      if (id === undefined) continue;
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
        const existing = ranks.get(item.id);
        if (existing !== undefined) return existing;
        ranks.set(item.id, 0);
        const deps = localEdges
          .filter((e) => e.target === item.id)
          .flatMap((e) => {
            const item = items.find((i) => i.id === e.source);
            return item ? [item] : [];
          });
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
          chunk.forEach((item, column) => {
            nodes.push({ item, column, up, height: heightOf(item) });
          });
          up +=
            height + (index + columns < row.length ? 12 : levelIndex < levels.length - 1 ? 60 : 0);
        }
      });
      return {
        nodes,
        columns,
        height: up,
        connected: items.some((i) => connected.has(i.id)),
        // Cyclic source data has no rank-zero member, but every card stays displayable.
        first: items.filter((i) => rank(i) === 0).sort(compare)[0] ?? [...items].sort(compare)[0],
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
export function canvasLayout(fixture: CanvasData, options: LayoutOptions) {
  const records = fixture.items,
    parents = fixture.parentIds,
    issueMetadata = fixture.metadata;
  const connections = fixture.connections;
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
    (issueMetadata[item.id].labels.length || !issueMetadata[item.id].labelsKnown ? 64 : 40) +
    18 * titleLines(item.id, CARD_W - 24, 13, `issue:${item.id}`);
  const labelColumn =
    Math.ceil(
      Math.max(
        0,
        ...records
          .filter((i) => i.pr)
          .map((i) => {
            if (!issueMetadata[i.id].labelsKnown) return textWidth('Labels unavailable', 9);
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
            (textWidth(`#${item.pr}`, 11) +
              item.issueNumbers.reduce((sum, issue) => sum + textWidth(`#${issue.number}`, 10), 0) +
              14 +
              item.issueNumbers.length * 20 +
              8) -
            84 -
            47 -
            24 -
            (item.thread ? 31 : 0),
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
                  linesFor(
                    `#${issueMetadata[item.parent].number} ${issueMetadata[item.parent].title}`,
                    badgeWidth,
                    9
                  )
                )
              : linesFor(
                  `#${issueMetadata[item.parent].number} ${issueMetadata[item.parent].title}`,
                  badgeWidth,
                  9
                )) -
            19
        )
      : 0);
  const padding = 12;
  let y = 32;
  for (const stage of stages.filter(
    (s) =>
      s.id !== 'review' &&
      (s.id !== 'unclassified' || records.some((i) => i.stage === 'unclassified'))
  )) {
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
      const issueLayout = arrangeIssues(members, connections, issueHeight, issueMetadata);
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
  const incoming = new Set(connections.map((edge) => edge.target));
  // Match issue-group clearance for the router's 20px bottom port and 32px turning room.
  const bottomPortClearance = 20 + 32;
  for (const [index, spec] of specs.entries()) {
    const column = index % columns,
      x = 32 + column * (PR_W + 96),
      rowY = columnY[column];
    const isCollapsed = options.collapsed?.has(`stack:${spec.key}`) ?? false;
    const ids = isCollapsed ? [] : [...spec.ids].reverse(),
      rows: StackRow[] = [];
    let offset = 32;
    for (const id of ids) {
      const item = records.find((i) => i.id === id);
      if (!item) continue;
      const previous = rows.at(-1);
      if (previous && !spec.stacked)
        offset += incoming.has(previous.item.id) ? bottomPortClearance : 12;
      const height = prHeight(item);
      rows.push({ item, key: String(id), y: rowY + offset, offset, height });
      offset += height;
    }
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
    const collapsedTarget =
      isCollapsed &&
      connections.some((edge) => spec.ids.includes(edge.target) && !spec.ids.includes(edge.source));
    columnY[column] = Math.max(
      rowY + offset + (collapsedTarget ? bottomPortClearance : 12),
      ...rows
        .filter((row) => incoming.has(row.item.id))
        .map((row) => row.y + row.height + bottomPortClearance)
    );
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
export function relationshipHighlights(
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
