import { expect, it } from 'vitest';
import { fakeV2Server, type FactoryV2Snapshot } from '../../src/http/index.js';
import { layout, related } from '../src/canvas/model';
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
  expect(new Set(graph.cards.map((c) => c.id)).size).toBe(Object.keys(board.entities.items).length);
  const stack = graph.groups.find((g) => g.stack);
  if (!stack) throw new Error('Expected sample stack');
  expect(
    stack.items.map((i) => (i.subject.kind === 'pull-request' ? i.subject.pullRequestId : null))
  ).toEqual(['pr:2004', 'pr:2003']);
  const blocked = Object.values(board.entities.items).find(
    (i) => i.subject.kind === 'issue' && i.subject.issueId === 'issue:1007'
  );
  if (!blocked) throw new Error('Expected blocked candidate');
  expect([...related(board, blocked, 'prerequisites')]).toEqual(['item:1002']);
  expect(related(board, blocked, 'prerequisites').has(blocked.id)).toBe(false);
  const edge = graph.routes.find((r) => r.source === blocked.id);
  expect(edge?.target).toBe('item:1002');
});
it('retains external dependency anchors when parent groups collapse', async () => {
  const board = await sample();
  const initial = layout(board, new Set());
  const planned = initial.groups.find((g) => g.stage === 'planned');
  if (!planned) throw new Error('Expected Planned group');
  const graph = layout(board, new Set([planned.key]));
  expect(graph.cards.some((c) => c.item.section === 'planned')).toBe(false);
  expect(graph.groups.find((g) => g.key === planned.key)?.collapsed).toBe(true);
  expect(graph.routes.some((r) => r.source === 'item:1007' && r.target === 'item:1002')).toBe(true);
});
it('routes around an intervening card and ends its arrow on the prerequisite', () => {
  const graph = routeCanvas(
    [
      { id: 'dependant', x: 50, y: 50, width: 100, height: 60 },
      { id: 'obstacle', x: 180, y: 50, width: 100, height: 160 },
      { id: 'prerequisite', x: 320, y: 50, width: 100, height: 60 },
    ],
    [{ source: 'dependant', target: 'prerequisite' }],
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
  const left = graph.cards.find((c) => c.id === 'item:1001'),
    right = graph.cards.find((c) => c.id === 'item:1007');
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
