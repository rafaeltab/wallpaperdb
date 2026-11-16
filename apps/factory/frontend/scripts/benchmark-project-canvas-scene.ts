import { isDeepStrictEqual } from 'node:util';
import { fakeV2Server, type FactoryV2Snapshot } from '../../src/http/index.js';
import { canvasLayout } from '../src/canvas/geometry';
import { createProjectCanvasScene } from '../src/canvas/project-canvas-scene';
import { createCanvasProjection } from '../src/canvas/view-model';
import { scenarioBoard } from '../test/fixtures/canvas/board';
import { buildScaleFixture } from '../test/fixtures/canvas/factory-scale-fixture';

/** Measures actual public scene updates; assertions run outside the timed section. */
export async function benchmarkProjectCanvasScene(rounds: number) {
  const app = fakeV2Server({ epoch: 'scene-benchmark' });
  const seed = (await app.inject('/api/v2/board')).json<FactoryV2Snapshot>();
  await app.close();
  const summarize = (times: number[]) => {
    times.sort((a, b) => a - b);
    return {
      medianMs: times[Math.floor(times.length / 2)],
      p95Ms: times[Math.min(times.length - 1, Math.ceil(times.length * 0.95) - 1)],
    };
  };
  for (const count of [100, 200, 300] as const) {
    const board = scenarioBoard(seed, buildScaleFixture(count));
    const options = { titleMode: 'ellipsis' as const, expandedNames: new Set<string>() };
    for (const kind of ['initial', 'status-only', 'geometry-change'] as const) {
      const scene = createProjectCanvasScene(),
        project = createCanvasProjection();
      scene(board, options);
      canvasLayout(project(board), options);
      const measurements = { current: [] as number[], baseline: [] as number[] };
      for (let round = 0; round < rounds; round++) {
        const item = Object.values(board.entities.items)[0];
        const next = {
          ...board,
          entities: {
            ...board.entities,
            items: {
              ...board.entities.items,
              [item.id]: {
                ...item,
                version: String(round + 2),
                status: { ...item.status, label: `Status ${round}`, active: !!(round % 2) },
              },
            },
          },
        };
        const display =
          kind === 'geometry-change'
            ? { ...options, collapsed: new Set(round % 2 ? [] : ['planned-none']) }
            : options;
        const candidates = {
          current: () =>
            (kind === 'initial' ? createProjectCanvasScene() : scene)(next, display).layout,
          baseline: () =>
            canvasLayout((kind === 'initial' ? createCanvasProjection() : project)(next), display),
        };
        let current: ReturnType<typeof canvasLayout> | undefined,
          baseline: ReturnType<typeof canvasLayout> | undefined;
        for (const label of round % 2
          ? (['baseline', 'current'] as const)
          : (['current', 'baseline'] as const)) {
          const start = performance.now();
          const value = candidates[label]();
          measurements[label].push(performance.now() - start);
          if (label === 'current') current = value;
          else baseline = value;
        }
        if (!isDeepStrictEqual(current, baseline))
          throw new Error(`Project canvas scene changed for ${count}/${kind}`);
      }
      console.log(
        JSON.stringify({
          scenario: `scene-${count}-${kind}`,
          rounds,
          measurements: {
            current: summarize(measurements.current),
            baseline: summarize(measurements.baseline),
          },
        })
      );
    }
  }
}
