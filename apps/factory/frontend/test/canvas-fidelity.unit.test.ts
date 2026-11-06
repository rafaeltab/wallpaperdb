import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { canvasLayout } from '../src/canvas/geometry';
import type { CanvasData } from '../src/canvas/view-model';
import { buildScaleFixture, type FixtureBundle } from './fixtures/canvas/factory-scale-fixture';

// Geometry recorded from PR #677 at ecd35afb, before porting the production canvas.
// Node uses the prototype's deterministic text-measurement fallback; browser tests
// separately verify the real font measurements and DOM dimensions.
it.each(['varied', 'nested', 'scale100', 'scale200', 'scale300'] as const)(
  'preserves the selected prototype packing for %s',
  (scenario) => {
    const fixture: FixtureBundle =
      scenario === 'varied' || scenario === 'nested'
        ? JSON.parse(
            readFileSync(
              new URL(`./fixtures/canvas/${scenario}.fixture.json`, import.meta.url),
              'utf8'
            )
          )
        : buildScaleFixture(scenario === 'scale100' ? 100 : scenario === 'scale200' ? 200 : 300);
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
      items: fixture.items.map((i) => ({
        ...i,
        active: false,
        issueNumbers: [{ number: i.id }],
        item: {
          id: `item:${i.id}`,
          version: '1',
          subject: { kind: 'issue', issueId: `issue:${i.id}` },
          section: i.stage === 'review' ? 'in-review' : i.stage,
          status: { code: 'ready', label: i.status, active: false, since: null },
          attention: { state: 'none', sourceIds: [] },
          jobIds: [],
          maintenanceIds: [],
          threadIds: [],
          actionIds: [],
        },
        thread: !!i.thread || (i.synthetic && i.stage !== 'planned'),
      })),
      connections: fixture.items
        .filter((i) => !i.pr)
        .flatMap((i) => i.deps.map((id) => ({ source: id, target: i.id }))),
    };
    if (scenario === 'nested')
      data.connections.push({ source: 642, target: 644 }, { source: 628, target: 666 });
    const graph = canvasLayout(data, { titleMode: 'ellipsis', expandedNames: new Set() });
    const result = {
      boxes: graph.boxes.map((b) => ({
        id: b.id,
        x: b.x,
        y: b.y,
        width: b.width,
        height: b.height,
      })),
      groups: graph.groups,
      panels: graph.panels.map(({ rows, ...p }) => p),
      areas: graph.areas,
      width: graph.width,
      height: graph.height,
      labelColumn: graph.labelColumn,
    };
    const golden = JSON.parse(
      readFileSync(new URL(`./fixtures/canvas/${scenario}.json`, import.meta.url), 'utf8')
    );
    // Unclassified is a v2-only section and has no effect on these archived scenarios.
    expect(result).toEqual(golden);
  }
);
