import { expect, it } from 'vitest';
import { fakeV2Server, type FactoryV2Snapshot } from '../../src/http/index.js';
import { related } from '../src/canvas/model';
import { createCanvasProjection } from '../src/canvas/view-model';
import { canvasLayout } from '../src/canvas/geometry';
import { scenarioBoard } from './fixtures/canvas/board';
function layout(board: FactoryV2Snapshot, collapsed: Set<string>) {
  return canvasLayout(createCanvasProjection()(board), {
    collapsed,
    titleMode: 'ellipsis',
    expandedNames: new Set(),
  });
}
import { routeCanvas } from '../src/canvas/routing';
async function sample() {
  const app = fakeV2Server({ epoch: 'layout' });
  try {
    return (await app.inject('/api/v2/board')).json<FactoryV2Snapshot>();
  } finally {
    await app.close();
  }
}
it('places each authoritative work item once and stacks tip above base', async () => {
  const board = await sample(),
    graph = layout(board, new Set());
  expect(new Set(graph.boxes.map((c) => c.id)).size).toBe(Object.keys(board.entities.items).length);
  const stack = graph.panels.find((g) => g.stacked);
  if (!stack) throw new Error('Expected sample stack');
  expect(
    stack.rows.map(({ item: { item: i } }) =>
      i.subject.kind === 'pull-request' ? i.subject.pullRequestId : null
    )
  ).toEqual(['pr:2004', 'pr:2003']);
  const blocked = Object.values(board.entities.items).find(
    (i) => i.subject.kind === 'issue' && i.subject.issueId === 'issue:1007'
  );
  if (!blocked) throw new Error('Expected blocked candidate');
  expect([...related(board, blocked, 'prerequisites')]).toEqual(['item:1002']);
  expect(related(board, blocked, 'prerequisites').has(blocked.id)).toBe(false);
  expect(graph.connections).toContainEqual({
    source: graph.boxes.find((b) => b.item.item.id === 'item:1002')?.id,
    target: graph.boxes.find((b) => b.item.item.id === blocked.id)?.id,
  });
});
it('retains external dependency anchors when parent groups collapse', async () => {
  const board = await sample();
  const initial = layout(board, new Set());
  const planned = initial.groups.find((g) => g.stage === 'planned');
  if (!planned) throw new Error('Expected Planned group');
  const graph = layout(board, new Set([planned.key]));
  expect(graph.boxes.some((c) => c.item.item.section === 'planned')).toBe(false);
  expect(graph.groups.find((g) => g.key === planned.key)?.collapsed).toBe(true);
  expect(graph.routingConnections.length).toBeGreaterThan(0);
  expect(graph.aggregateNodes.length).toBeGreaterThan(0);
});
it('routes around an intervening card and ends its arrow on the prerequisite', () => {
  const graph = routeCanvas(
    [
      { id: 1, x: 50, y: 50, width: 100, height: 60 },
      { id: 2, x: 180, y: 50, width: 100, height: 160 },
      { id: 3, x: 320, y: 50, width: 100, height: 60 },
    ],
    [{ source: 3, target: 1 }],
    500,
    350
  );
  expect(graph[0].failed).toBe(false);
  expect(graph[0].points.at(-1)?.y).toBe(110);
  expect(graph[0].points.some((p) => p.y > 210 || p.y < 50)).toBe(true);
});
it('distinguishes current, previous, and head-only provider evidence', async () => {
  const { comparisonLabel } = await import('../src/canvas/presentation');
  const board = await sample(),
    pr = board.entities.pullRequests['pr:2003'];
  if (pr.metadata.state !== 'known') throw new Error('Expected current PR metadata');
  const current = pr.metadata.value.comparison;
  expect(comparisonLabel(pr, current)).toBe('Current comparison');
  expect(comparisonLabel(pr, { ...current, headOid: 'previous-head' })).toBe('Previous comparison');
  expect(comparisonLabel(pr, { ...current, baseOid: null, baseRef: null })).toBe(
    'Head-only evidence; tested base unknown'
  );
});
it('packs sibling issues into two lanes inside their parent namespace', async () => {
  const board = await sample(),
    graph = layout(board, new Set());
  const left = graph.boxes.find((c) => c.item.item.id === 'item:1001'),
    right = graph.boxes.find((c) => c.item.item.id === 'item:1007');
  if (!left || !right) throw new Error('Expected planned sibling issues');
  expect(left.x).not.toBe(right.x);
  expect(left.y).toBe(right.y);
  expect(Math.abs(left.x - right.x)).toBeGreaterThanOrEqual(left.width);
});
it('highlights verified PR-base relationships in the selected direction', async () => {
  const board = await sample();
  expect([...related(board, board.entities.items['item:1004'], 'prerequisites')]).toEqual([
    'item:1003',
  ]);
  expect([...related(board, board.entities.items['item:1003'], 'dependants')]).toEqual([
    'item:1004',
  ]);
  expect(related(board, board.entities.items['item:1004'], 'dependants').size).toBe(0);
});

it('keeps opaque work identities stable across snapshots and separate from displayed GitHub numbers', async () => {
  const seed = await sample(),
    project = createCanvasProjection();
  const first = project(seed);
  const board = {
    ...seed,
    entities: {
      ...seed.entities,
      pullRequests: {
        ...seed.entities.pullRequests,
        'pr:2003': { ...seed.entities.pullRequests['pr:2003'], number: 1003 },
      },
    },
  };
  const next = project(board);
  expect(new Set(next.items.map((i) => i.id)).size).toBe(Object.keys(board.entities.items).length);
  for (const item of first.items)
    expect(next.items.find((i) => i.item.id === item.item.id)?.id).toBe(item.id);
  const pr = next.items.find((i) => i.item.id === 'item:1003');
  expect(pr?.pr).toBe(1003);
  expect(pr?.issueNumbers[0].number).toBe(1003);
});
it('does not let cyclic parent context hide authoritative work items', async () => {
  const seed = await sample();
  const edge = Object.values(seed.entities.relationships).find((r) => r.kind === 'parent');
  if (!edge || edge.kind !== 'parent') throw new Error('Expected parent relation');
  const board = {
    ...seed,
    entities: {
      ...seed.entities,
      relationships: {
        ...seed.entities.relationships,
        'relationship:cycle': {
          ...edge,
          id: 'relationship:cycle' as const,
          parentIssueId: edge.childIssueId,
          childIssueId: edge.parentIssueId,
        },
      },
    },
  };
  const graph = layout(board, new Set());
  expect(graph.boxes).toHaveLength(Object.keys(board.entities.items).length);
});

it('uses PR ancestry for selection while stack ordering supplies its visual connection', async () => {
  const data = createCanvasProjection()(await sample());
  const base = data.items.find((i) => i.item.id === 'item:1003'),
    tip = data.items.find((i) => i.item.id === 'item:1004');
  if (!base || !tip) throw new Error('Expected stacked items');
  expect(data.selectionConnections).toContainEqual({ source: base.id, target: tip.id });
  expect(data.connections).not.toContainEqual({ source: base.id, target: tip.id });
});

it.each(['separate-stacks', 'independent'])(
  'renders verified PR ancestry between %s cards',
  async (placement) => {
    const board = await sample(),
      stack = Object.values(board.entities.stacks)[0];
    if (!stack) throw new Error('Expected sample stack');
    board.entities.stacks =
      placement === 'independent'
        ? {}
        : {
            'stack:base': { ...stack, id: 'stack:base', pullRequestIdsBaseToTip: ['pr:2003'] },
            'stack:tip': { ...stack, id: 'stack:tip', pullRequestIdsBaseToTip: ['pr:2004'] },
          };
    const graph = layout(board, new Set()),
      base = graph.boxes.find((box) => box.item.item.id === 'item:1003'),
      tip = graph.boxes.find((box) => box.item.item.id === 'item:1004');
    if (!base || !tip) throw new Error('Expected visible PR cards');
    expect(graph.connections).toContainEqual({ source: base.id, target: tip.id });
    expect(graph.routingConnections).toContainEqual({ source: base.id, target: tip.id });
  }
);

it.each([
  {
    name: 'fork',
    numbers: [10, 11, 12],
    edges: [
      [10, 11],
      [10, 12],
    ],
    prefix: [],
    routes: 2,
  },
  {
    name: 'mixed fork',
    numbers: [10, 11, 12, 13],
    edges: [
      [10, 11],
      [11, 12],
      [11, 13],
    ],
    prefix: [10, 11],
    routes: 2,
  },
  { name: 'unconnected PRs', numbers: [10, 11, 12], edges: [], prefix: [], routes: 0, gap: 12 },
  {
    name: 'linear stack',
    numbers: [10, 11, 12],
    edges: [
      [10, 11],
      [11, 12],
    ],
    prefix: [10, 11, 12],
    routes: 0,
    gap: 0,
  },
])('routes $name ancestry around the PR cards', async (scenario) => {
  const seed = await sample();
  const base = scenarioBoard(seed, {
    items: scenario.numbers.map((n) => ({
      id: n,
      pr: n,
      stage: 'review',
      status: 'Needs review',
      deps: [],
    })),
    metadata: Object.fromEntries(
      scenario.numbers.map((n) => [
        n,
        {
          number: n,
          title: `PR ${n}`,
          url: '',
          labels: [],
          priority: null,
          size: null,
        },
      ])
    ),
    parentIds: [],
    parentOf: {},
    synthetic: true,
    stackSpecs: scenario.prefix.length
      ? [{ key: 'prefix', ids: scenario.prefix, stacked: true }]
      : [],
  });
  type Relationship =
    FactoryV2Snapshot['entities']['relationships'][keyof FactoryV2Snapshot['entities']['relationships']];
  const relationships: Record<Relationship['id'], Relationship> = {};
  for (const [from, to] of scenario.edges) {
    const id: Relationship['id'] = `relationship:fork-${from}-${to}`;
    relationships[id] = {
      id,
      version: '1',
      kind: 'pr-base',
      basePullRequestId: `pr:visual-${from}`,
      tipPullRequestId: `pr:visual-${to}`,
      evidence: {
        state: 'known',
        value: 'git-ancestry',
        sourceId: 'source:github',
        observedAt: seed.committedAt,
      },
    };
  }
  const board: FactoryV2Snapshot = { ...base, entities: { ...base.entities, relationships } },
    graph = layout(board, new Set());
  const routes = routeCanvas(
    [
      ...graph.boxes,
      ...graph.headerNodes,
      ...graph.aggregateNodes,
      ...graph.panels.map((p, i) => ({ id: -500 - i, x: p.x, y: p.y, width: p.width, height: 32 })),
      ...graph.areas.map((a, i) => ({ id: -100 - i, x: 20, y: a.y - 10, width: 310, height: 20 })),
      ...[...graph.groups, ...graph.panels].flatMap((g, i) =>
        [
          [g.x, g.y],
          [g.x + g.width, g.y],
          [g.x, g.y + g.height],
          [g.x + g.width, g.y + g.height],
        ].map(([x, y], j) => ({ id: -1000 - i * 4 - j, x, y, width: 0, height: 0 }))
      ),
    ],
    graph.routingConnections,
    graph.width,
    graph.height
  );
  expect(routes).toHaveLength(scenario.routes);
  expect(routes.every((route) => !route.failed)).toBe(true);
  if (scenario.gap !== undefined)
    for (const panel of graph.panels)
      for (let i = 1; i < panel.rows.length; i++)
        expect(panel.rows[i].y - panel.rows[i - 1].y - panel.rows[i - 1].height).toBe(scenario.gap);
});

it('displays a cyclic prerequisite component beside another dependency chain', async () => {
  const seed = await sample(),
    edge = Object.values(seed.entities.relationships).find((r) => r.kind === 'prerequisite');
  if (!edge || edge.kind !== 'prerequisite') throw new Error('Expected prerequisite fixture');
  const items = { ...seed.entities.items };
  for (const item of Object.values(items)) {
    if (['item:1001', 'item:1002', 'item:1005', 'item:1007'].includes(item.id))
      items[item.id] = {
        ...item,
        section: 'planned',
        jobIds: [],
        threadIds: [],
        actionIds: [],
        status: { code: 'ready', label: 'Ready', active: false, since: null },
      };
    else delete items[item.id];
  }
  const board: FactoryV2Snapshot = {
    ...seed,
    entities: {
      ...seed.entities,
      items,
      relationships: {
        'relationship:cycle-a': {
          ...edge,
          id: 'relationship:cycle-a',
          prerequisiteIssueId: 'issue:1001',
          dependantIssueId: 'issue:1002',
        },
        'relationship:cycle-b': {
          ...edge,
          id: 'relationship:cycle-b',
          prerequisiteIssueId: 'issue:1002',
          dependantIssueId: 'issue:1001',
        },
        'relationship:chain': {
          ...edge,
          id: 'relationship:chain',
          prerequisiteIssueId: 'issue:1005',
          dependantIssueId: 'issue:1007',
        },
      },
    },
  };
  const graph = layout(board, new Set());
  expect(new Set(graph.boxes.map((box) => box.item.item.id))).toEqual(new Set(Object.keys(items)));
  expect(
    graph.boxes.every((box) => [box.x, box.y, box.width, box.height].every(Number.isFinite))
  ).toBe(true);
});
