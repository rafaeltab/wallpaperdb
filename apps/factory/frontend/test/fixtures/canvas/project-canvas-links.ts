import { readFileSync } from 'node:fs';
import { canvasLayout } from '../../../src/canvas/geometry';
import { createItemDependencyLinkInput } from '../../../src/canvas/item-dependency-links';
import type { CanvasData } from '../../../src/canvas/view-model';
import { buildScaleFixture, type FixtureBundle } from './factory-scale-fixture';

export function projectCanvasLinkScenarios() {
  const arranged = ['varied', 'nested', 'scale100', 'scale200', 'scale300'].flatMap((name) => {
    const fixture: FixtureBundle =
      name === 'varied' || name === 'nested'
        ? JSON.parse(readFileSync(new URL(`./${name}.fixture.json`, import.meta.url), 'utf8'))
        : buildScaleFixture(name === 'scale100' ? 100 : name === 'scale200' ? 200 : 300);
    const data: CanvasData = {
      ...fixture,
      metadata: Object.fromEntries(
        Object.entries(fixture.metadata).map(([id, meta]) => [
          id,
          {
            ...meta,
            projectKnown: true,
            labelsKnown: true,
            priorityRank: meta.priority
              ? ['P0', 'P1', 'P2', 'P3', 'P4'].indexOf(meta.priority)
              : undefined,
            sizeRank: meta.size ? ['XS', 'S', 'M', 'L', 'XL'].indexOf(meta.size) : undefined,
          },
        ])
      ),
      items: fixture.items.map((item) => ({
        ...item,
        active: false,
        issueNumbers: [{ number: item.id }],
        item: {
          id: `item:${item.id}`,
          version: '1',
          subject: { kind: 'issue', issueId: `issue:${item.id}` },
          section: item.stage === 'review' ? 'in-review' : item.stage,
          status: { code: 'ready', label: item.status, active: false, since: null },
          attention: { state: 'none', sourceIds: [] },
          jobIds: [],
          maintenanceIds: [],
          threadIds: [],
          actionIds: [],
        },
        thread: !!item.thread || (item.synthetic && item.stage !== 'planned'),
      })),
      connections: fixture.items
        .filter((item) => !item.pr)
        .flatMap((item) => item.deps.map((id) => ({ source: id, target: item.id }))),
    };
    if (name === 'nested')
      data.connections.push({ source: 642, target: 644 }, { source: 628, target: 666 });
    return (['ellipsis', 'wrap', 'expand'] as const).map((titleMode) => {
      const layout = canvasLayout(data, {
        titleMode,
        expandedNames: new Set(titleMode === 'expand' ? [`issue:${fixture.items[0].id}`] : []),
        collapsed: new Set(titleMode === 'expand' ? [`planned-${fixture.parentIds[0]}`] : []),
      });
      return { name: `${name}-${titleMode}`, input: createItemDependencyLinkInput(layout) };
    });
  });
  const ends = [
    { id: 1, x: 50, y: 50, width: 100, height: 60 },
    { id: 2, x: 320, y: 50, width: 100, height: 60 },
  ];
  return [
    ...arranged,
    { name: 'empty', input: { nodes: [], edges: [], width: 500, height: 350 } },
    {
      name: 'missing-endpoint',
      input: { nodes: ends, edges: [{ source: 1, target: 99 }], width: 500, height: 350 },
    },
    {
      name: 'blocked-fallback',
      input: {
        nodes: [...ends, { id: 3, x: 0, y: 0, width: 1000, height: 1000 }],
        edges: [{ source: 2, target: 1 }],
        width: 500,
        height: 350,
      },
    },
    {
      name: 'shared-header-ports',
      input: {
        nodes: [
          ...ends,
          { id: 3, x: 50, y: 50, width: 100, height: 60, header: true },
          { id: 4, x: 320, y: 200, width: 100, height: 60 },
        ],
        edges: [
          { source: 1, target: 2 },
          { source: 3, target: 4 },
          { source: 4, target: 3 },
        ],
        width: 500,
        height: 350,
      },
    },
  ];
}
