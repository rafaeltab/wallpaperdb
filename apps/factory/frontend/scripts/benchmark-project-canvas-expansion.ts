import { chromium, firefox, expect as browserExpect, type Page } from '@playwright/test';
import { build, preview } from 'vite';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { createHash } from 'node:crypto';
import { fakeV2Server, type FactoryV2Snapshot } from '../../src/http/index.js';
import { createCanvasProjection } from '../src/canvas/view-model';
import { canvasLayout } from '../src/canvas/geometry';
import { createItemDependencyLinkInput } from '../src/canvas/item-dependency-links';
import type { routeCanvas } from '../src/canvas/routing';
import { scenarioBoard } from '../test/fixtures/canvas/board';
import {
  buildScaleFixture,
  type FixtureBundle,
} from '../test/fixtures/canvas/factory-scale-fixture';

function option(name: string) {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
  return value;
}
const rounds = Number(option('--rounds') ?? 5);
const budget = Number(option('--budget-ms') ?? 100);
if (!Number.isInteger(rounds) || rounds < 1) throw new Error('--rounds must be a positive integer');
if (!Number.isFinite(budget) || budget <= 0) throw new Error('--budget-ms must be positive');
// Recorded from PR #771's router at 2695e8b. Regular runs never regenerate expectations.
const fixturePath = new URL('../test/fixtures/canvas/expansion100.json', import.meta.url);
const seedServer = fakeV2Server({ epoch: 'project-canvas-expansion-benchmark' });
const seed = (await seedServer.inject('/api/v2/board')).json<FactoryV2Snapshot>();
await seedServer.close();
const mixed = buildScaleFixture(100);
const planned: FixtureBundle = {
  ...mixed,
  items: mixed.items.map(({ pr: _pr, ...item }) => ({
    ...item,
    stage: 'planned',
    thread: undefined,
  })),
  stackSpecs: [],
};
const scenarios = [
  { name: 'mixed100', fixture: mixed },
  { name: 'planned100', fixture: planned },
  {
    name: 'dependency-rich100',
    fixture: {
      ...planned,
      items: planned.items.map((item, index) => ({
        ...item,
        deps:
          index >= 20 && index % 3 !== 0
            ? [...new Set([...item.deps, planned.items[index - 20].id])]
            : [...item.deps],
      })),
    },
  },
];

// This source also runs inside the browser, so keep it independent of module state.
const snapshotSource = `() => {
  const rect = element => ['left','top','width','height'].map(key => Number.parseFloat(element.style[key]) || 0);
  const world = document.querySelector('.cc-world');
  if (!world) return null;
  return {
    size: [Number.parseFloat(world.style.width), Number.parseFloat(world.style.height)],
    boxes: [...document.querySelectorAll('.cc-item')].map(element => ({ id: Number(element.dataset.card), rect: rect(element) })).sort((a,b) => a.id-b.id),
    groups: [...document.querySelectorAll('.cc-parent-group')].map(rect),
    panels: [...document.querySelectorAll('.cc-pr-panel')].map(rect),
    links: [...document.querySelectorAll('.cc-line[data-edge]')].map(element => ({key: element.dataset.edge, d: element.getAttribute('d'), points: JSON.parse(element.dataset.points), failed: element.dataset.failed === 'true', color: element.getAttribute('stroke'), marker: element.getAttribute('marker-start')})).sort((a,b) => a.key.localeCompare(b.key))
  };
}`;
type Snapshot = {
  size: number[];
  boxes: { id: number; rect: number[] }[];
  groups: number[][];
  panels: number[][];
  links: {
    key: string;
    d: string;
    points: { x: number; y: number }[];
    failed: boolean;
    color: string;
    marker: string;
  }[];
};
type Expected = { name: string; expanded: Snapshot; initial: Snapshot };
function expectedSnapshot(
  board: FactoryV2Snapshot,
  project: ReturnType<typeof createCanvasProjection>,
  collapsed: boolean,
  route: typeof routeCanvas
): Snapshot {
  const data = project(board);
  const keys = new Set([
    ...['planned', 'working', 'unclassified'].flatMap((stage) =>
      [...data.parentIds, 'none'].map((id) => `${stage}-${id}`)
    ),
    ...data.stackSpecs.map((stack) => `stack:${stack.key}`),
  ]);
  const layout = canvasLayout(data, {
    titleMode: 'ellipsis',
    expandedNames: new Set(),
    collapsed: collapsed ? keys : new Set(),
  });
  const input = createItemDependencyLinkInput(layout);
  return {
    size: [layout.width, layout.height],
    boxes: layout.boxes
      .map((box) => ({ id: box.id, rect: [box.x, box.y, box.width, box.height] }))
      .sort((a, b) => a.id - b.id),
    groups: layout.groups.map((group) => [group.x, group.y, group.width, group.height]),
    panels: layout.panels.map((panel) => [panel.x, panel.y, panel.width, panel.height]),
    links: route(input.nodes, input.edges, input.width, input.height)
      .map((link) => ({
        key: link.key,
        d: link.d,
        points: link.points,
        failed: link.failed,
        color: link.color,
        marker: `url(#cc-arrow-${link.key})`,
      }))
      .sort((a, b) => a.key.localeCompare(b.key)),
  };
}
const makeInitial = (fixture: FixtureBundle) =>
  scenarioBoard(seed, {
    ...fixture,
    metadata: {
      ...fixture.metadata,
      [fixture.parentIds[0]]: {
        ...fixture.metadata[fixture.parentIds[0]],
        title: 'Before benchmark dependencies arrive',
      },
    },
    items: fixture.items.map((item) => ({ ...item, deps: [] })),
  });
if (process.argv.includes('--record-baseline')) {
  const baselinePath = option('--baseline-router');
  if (!baselinePath)
    throw new Error('--record-baseline requires --baseline-router from the pinned predecessor');
  const baseline: { routeCanvas: typeof routeCanvas } = await import(
    pathToFileURL(resolve(baselinePath)).href
  );
  const expected = scenarios.map(({ name, fixture }) => {
    const project = createCanvasProjection();
    const initial = expectedSnapshot(makeInitial(fixture), project, false, baseline.routeCanvas);
    const board = scenarioBoard(seed, fixture);
    return {
      name,
      initial,
      expanded: expectedSnapshot(board, project, false, baseline.routeCanvas),
    };
  });
  await writeFile(fixturePath, `${JSON.stringify(expected)}\n`);
  console.log(`Recorded ${expected.length} expansion baselines from ${baselinePath}`);
  process.exit(0);
}
const expectedText = await readFile(fixturePath, 'utf8');
const expected: Expected[] = JSON.parse(expectedText);
const fixtureSha256 = createHash('sha256').update(expectedText).digest('hex');
const directory = await mkdtemp(join(tmpdir(), 'project-canvas-expansion-'));
const source = resolve(option('--source') ?? 'frontend');
let server: Awaited<ReturnType<typeof preview>> | undefined;
try {
  await build({
    configFile: 'frontend/vite.config.ts',
    root: source,
    logLevel: 'error',
    build: { outDir: directory, emptyOutDir: true },
  });
  server = await preview({
    configFile: false,
    root: source,
    build: { outDir: directory },
    preview: { host: '127.0.0.1', port: 0 },
  });
  const origin = server.resolvedUrls?.local[0];
  if (!origin) throw new Error('Expansion benchmark origin unavailable');
  type Sample = {
    durationMs: number;
    workerDurationsMs: number[];
    maxFrameMs: number;
    longTasksMs: number[] | null;
  };
  const failures: string[] = [];
  const results: {
    browser: string;
    scenario: string;
    round: number;
    uncached: Sample;
    repeat: Sample;
  }[] = [];
  async function waitSnapshot(page: Page, value: Snapshot) {
    try {
      await page.waitForFunction(
        `document.querySelector('.cc-viewport')?.getAttribute('aria-busy') === 'false' && JSON.stringify((${snapshotSource})()) === ${JSON.stringify(JSON.stringify(value))}`,
        undefined,
        { timeout: 15000 }
      );
    } catch (error) {
      const actual: Snapshot = await page.evaluate(`(${snapshotSource})()`);
      console.error(JSON.stringify({ event: 'readiness-mismatch', expected: value, actual }));
      const fields = Object.keys(value).filter(
        (key) => !isDeepStrictEqual(value[key as keyof Snapshot], actual[key as keyof Snapshot])
      );
      throw new Error(`Canvas snapshot mismatch: ${fields.join(', ')}`, { cause: error });
    }
  }
  async function waitCollapsed(page: Page) {
    await browserExpect(page.locator('.cc-item')).toHaveCount(0);
    await browserExpect(page.locator('.cc-viewport')).toHaveAttribute('aria-busy', 'false');
    await browserExpect(
      page.locator(
        '.cc-parent-group button[aria-expanded="true"],.cc-pr-panel button[aria-expanded="true"]'
      )
    ).toHaveCount(0);
  }
  async function measureExpand(page: Page, value: Snapshot): Promise<Sample> {
    await page.evaluate(`((expected) => {
    window.__expansionMeasure = new Promise((resolve, reject) => {
      const button = document.querySelector('[aria-label="Expand all sections"]');
      if (!button) throw new Error('Missing Expand all');
      button.addEventListener('click', () => {
        const start = performance.now(), workerStart = window.__expansionWorkers.length;
        const frames = []; let last = start;
        const tasks = [];
        const observer = typeof PerformanceObserver === 'function' && PerformanceObserver.supportedEntryTypes.includes('longtask') ? new PerformanceObserver(list => tasks.push(...list.getEntries().map(entry=>entry.duration))) : null;
        observer?.observe({type:'longtask'});
        const snapshot = ${snapshotSource};
        function tick() {
          const now = performance.now(); frames.push(now-last); last=now;
          if (now-start > 15000) { observer?.disconnect(); reject(new Error('Expansion readiness deadline exceeded')); return; }
          const ready = document.querySelector('.cc-viewport')?.getAttribute('aria-busy') === 'false' && document.querySelectorAll('.cc-item').length === 100;
          if (ready && JSON.stringify(snapshot()) === expected) {
            requestAnimationFrame(() => {
              const end=performance.now(); frames.push(end-last);
              tasks.push(...(observer?.takeRecords().map(entry=>entry.duration) ?? [])); observer?.disconnect();
              resolve({ durationMs: end-start, workerDurationsMs: window.__expansionWorkers.slice(workerStart).map(worker=>worker.duration), maxFrameMs: Math.max(...frames), longTasksMs: observer ? tasks : null });
            });
          } else requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
      }, { once: true, capture: true });
    });
  })(${JSON.stringify(JSON.stringify(value))})`);
    await page.getByRole('button', { name: 'Expand all sections', exact: true }).click();
    return page.evaluate('window.__expansionMeasure');
  }
  for (const [browserName, engine] of [
    ['chromium', chromium],
    ['firefox', firefox],
  ] as const) {
    const browser = await engine.launch({ headless: true });
    try {
      console.log(
        JSON.stringify({
          event: 'environment',
          browser: browserName,
          version: browser.version(),
          build: 'production',
          items: 100,
          rounds,
          budgetMs: budget,
          viewport: { width: 1600, height: 1000 },
          expectation: 'Pinned predecessor routing and geometry, no real backend',
          fixtureSha256,
        })
      );
      for (const scenario of scenarios) {
        const golden = expected.find((value) => value.name === scenario.name);
        if (!golden) throw new Error(`Missing ${scenario.name} baseline`);
        console.log(
          JSON.stringify({
            event: 'workload',
            scenario: scenario.name,
            items: 100,
            links: golden.expanded.links.length,
          })
        );
        for (let round = 0; round < rounds; round++) {
          const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
          const errors: string[] = [];
          page.on('pageerror', (error) => errors.push(error.message));
          let board = makeInitial(scenario.fixture),
            delivered: FactoryV2Snapshot | undefined;
          await page.route('**/api/**', (route) => {
            if (!route.request().url().endsWith('/api/v2/board'))
              return route.fulfill({ status: 404 });
            if (board === delivered) return route.fulfill({ status: 304 });
            delivered = board;
            return route.fulfill({ json: board });
          });
          await page.addInitScript(`
            window.__expansionWorkers = []; window.__expansionBoardReads = 0;
            const NativeWorker=window.Worker;
            window.Worker=class extends NativeWorker {
              constructor(...args) { super(...args); this.requests=new Map(); this.addEventListener('message', event=>{const entry=this.requests.get(event.data?.id);if(entry) entry.duration=performance.now()-entry.start;}); }
              postMessage(message,...args) {const entry={start:performance.now(),duration:null};this.requests.set(message.id,entry);window.__expansionWorkers.push(entry);return super.postMessage(message,...args);}
            };
            const nativeFetch=window.fetch;
            window.fetch=async function(...args) {const response=await nativeFetch.apply(this,args);if(String(args[0])==='/api/v2/board'&&response.status===200){const json=response.json.bind(response);response.json=async()=>{const value=await json();window.__expansionBoardReads++;return value;};}return response;};
          `);
          try {
            await page.goto(origin);
            await waitSnapshot(page, golden.initial);
            await page.getByRole('button', { name: 'Collapse all sections', exact: true }).click();
            await waitCollapsed(page);
            const reads = await page.evaluate('window.__expansionBoardReads');
            board = scenarioBoard(seed, scenario.fixture);
            await page.waitForFunction(`window.__expansionBoardReads > ${reads}`);
            await browserExpect(
              page
                .getByRole('group', {
                  name: `Select ${scenario.fixture.metadata[scenario.fixture.parentIds[0]].title}`,
                  exact: true,
                })
                .first()
            ).toBeVisible();
            await waitCollapsed(page);
            const uncached = await measureExpand(page, golden.expanded);
            await page.getByRole('button', { name: 'Collapse all sections', exact: true }).click();
            await waitCollapsed(page);
            const repeat = await measureExpand(page, golden.expanded);
            if (errors.length) throw new Error(errors.join('\n'));
            const result = {
              browser: browserName,
              scenario: scenario.name,
              round,
              uncached,
              repeat,
            };
            results.push(result);
            console.log(JSON.stringify({ event: 'sample', ...result }));
            for (const [phase, sample] of [
              ['uncached', uncached],
              ['repeat', repeat],
            ] as const)
              if (sample.durationMs >= budget)
                failures.push(
                  `${browserName}/${scenario.name}/${phase}/${round}: ${sample.durationMs.toFixed(2)} ms`
                );
          } catch (error) {
            console.error(
              JSON.stringify(
                await page.evaluate(
                  `({ event: 'failed-page-state', reads: window.__expansionBoardReads, busy: document.querySelector('.cc-viewport')?.getAttribute('aria-busy'), groups: [...document.querySelectorAll('.cc-parent-head')].map(element=>element.getAttribute('aria-label')), text: document.body.innerText.slice(0,1500) })`
                )
              )
            );
            throw error;
          } finally {
            await page.close();
          }
        }
      }
    } finally {
      await browser.close();
    }
  }
  for (const browser of ['chromium', 'firefox'])
    for (const scenario of scenarios)
      for (const phase of ['uncached', 'repeat'] as const) {
        const samples = results
          .filter((value) => value.browser === browser && value.scenario === scenario.name)
          .map((value) => value[phase].durationMs)
          .sort((a, b) => a - b);
        console.log(
          JSON.stringify({
            event: 'summary',
            browser,
            scenario: scenario.name,
            phase,
            samplesMs: samples,
            minMs: samples[0],
            medianMs: samples[Math.floor(samples.length / 2)],
            maxMs: samples.at(-1),
            budgetMs: budget,
          })
        );
      }
  if (failures.length) {
    console.error(
      `Expansion budget exceeded in ${failures.length} samples:\n${failures.join('\n')}`
    );
    if (!process.argv.includes('--report-only')) process.exitCode = 1;
  }
} finally {
  try {
    if (server) {
      const owned = server;
      await new Promise<void>((resolveClose, reject) =>
        owned.httpServer.close((error) => (error ? reject(error) : resolveClose()))
      );
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
