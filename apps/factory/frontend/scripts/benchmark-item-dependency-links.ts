import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { computeItemDependencyLinks } from '../src/canvas/item-dependency-links';
import { projectCanvasLinkScenarios } from '../test/fixtures/canvas/project-canvas-links';
import { benchmarkProjectCanvasScene } from './benchmark-project-canvas-scene';

const goldenPath = new URL('../test/fixtures/canvas/item-dependency-links.json', import.meta.url);
const scenarios = projectCanvasLinkScenarios();
const baselineIndex = process.argv.indexOf('--baseline');
const baseline: typeof computeItemDependencyLinks | undefined =
  baselineIndex >= 0
    ? await import(pathToFileURL(process.argv[baselineIndex + 1]).href).then(
        ({ routeCanvas }) =>
          (input) =>
            routeCanvas(input.nodes, input.edges, input.width, input.height)
      )
    : undefined;
const candidateIndex = process.argv.indexOf('--candidate');
const candidate: typeof computeItemDependencyLinks | undefined =
  candidateIndex >= 0
    ? await import(pathToFileURL(process.argv[candidateIndex + 1]).href).then(
        ({ routeCanvas }) =>
          (input) =>
            routeCanvas(input.nodes, input.edges, input.width, input.height)
      )
    : undefined;
const candidates: [string, typeof computeItemDependencyLinks][] = [
  ['current', computeItemDependencyLinks],
  ...(baseline ? [['baseline', baseline] as [string, typeof computeItemDependencyLinks]] : []),
  ...(candidate ? [['candidate', candidate] as [string, typeof computeItemDependencyLinks]] : []),
];
if (process.argv.includes('--record')) {
  writeFileSync(
    goldenPath,
    `${JSON.stringify(scenarios.map(({ name, input }) => ({ name, input, links: (baseline ?? computeItemDependencyLinks)(input) })))}\n`
  );
  console.log(`Recorded ${scenarios.length} Project canvas dependency-link baselines.`);
} else {
  const goldens: { name: string; links: unknown }[] = JSON.parse(readFileSync(goldenPath, 'utf8'));
  for (const scenario of scenarios.filter((scenario) => scenario.name.endsWith('-ellipsis'))) {
    // Every candidate receives the same full correctness pass and warmup work.
    for (const [label, compute] of candidates) {
      if (
        !isDeepStrictEqual(
          compute(scenario.input),
          goldens.find((golden) => golden.name === scenario.name)?.links
        )
      ) {
        throw new Error(`Item dependency links changed for ${label}: ${scenario.name}`);
      }
    }
  }
  const roundsIndex = process.argv.indexOf('--rounds');
  const rounds = roundsIndex >= 0 ? Number(process.argv[roundsIndex + 1]) : 5;
  if (process.argv.includes('--scene')) await benchmarkProjectCanvasScene(rounds);
  for (const { name, input } of scenarios.filter((scenario) =>
    scenario.name.endsWith('-ellipsis')
  )) {
    const measurements: Record<string, number[]> = Object.fromEntries(
      candidates.map(([label]) => [label, []])
    );
    for (const [, compute] of candidates) compute(input);
    for (let round = 0; round < rounds; round++) {
      for (const [label, compute] of round % 2 ? [...candidates].reverse() : candidates) {
        const start = performance.now();
        const links = compute(input);
        measurements[label].push(performance.now() - start);
        if (!isDeepStrictEqual(links, goldens.find((golden) => golden.name === name)?.links))
          throw new Error(`Benchmark result changed for ${name}`);
      }
    }
    console.log(
      JSON.stringify({
        scenario: name,
        nodes: input.nodes.length,
        links: input.edges.length,
        rounds,
        measurements: Object.fromEntries(
          Object.entries(measurements).map(([label, times]) => {
            times.sort((a, b) => a - b);
            return [
              label,
              {
                medianMs: times[Math.floor(times.length / 2)],
                p95Ms: times[Math.min(times.length - 1, Math.ceil(times.length * 0.95) - 1)],
              },
            ];
          })
        ),
      })
    );
  }
}
