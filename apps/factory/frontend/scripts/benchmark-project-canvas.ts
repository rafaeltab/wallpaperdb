import { chromium, firefox, expect as browserExpect } from '@playwright/test';
import { createServer } from 'vite';
import { resolve } from 'node:path';
import { fakeV2Server, type FactoryV2Snapshot } from '../../src/http/index.js';
import { scenarioBoard } from '../test/fixtures/canvas/board';
import { buildScaleFixture } from '../test/fixtures/canvas/factory-scale-fixture';

const roundsIndex = process.argv.indexOf('--rounds');
const rounds = roundsIndex < 0 ? 3 : Number(process.argv[roundsIndex + 1]);
if (!Number.isInteger(rounds) || rounds < 1) throw new Error('--rounds must be a positive integer');
const sourceIndex = process.argv.indexOf('--source');
if (sourceIndex >= 0 && !process.argv[sourceIndex + 1])
  throw new Error('--source requires a frontend directory');
const root = sourceIndex < 0 ? resolve('frontend') : resolve(process.argv[sourceIndex + 1]);
const seedServer = fakeV2Server({ epoch: 'project-canvas-benchmark' });
const seed = (await seedServer.inject('/api/v2/board')).json<FactoryV2Snapshot>();
await seedServer.close();
const vite = await createServer({
  configFile: false,
  root,
  esbuild: { jsx: 'automatic' },
  server: { port: 0, fs: { allow: [resolve('.'), root] } },
});
await vite.listen();
const origin = vite.resolvedUrls?.local[0];
if (!origin) throw new Error('Project canvas benchmark origin unavailable');
const summarize = (values: number[]) => {
  const ordered = [...values].sort((a, b) => a - b);
  return {
    medianMs: ordered[Math.floor(ordered.length / 2)],
    p95Ms: ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * 0.95) - 1)],
  };
};
try {
  for (const [browserName, engine] of [
    ['chromium', chromium],
    ['firefox', firefox],
  ] as const) {
    const browser = await engine.launch({ headless: true });
    try {
      for (const count of [100, 200, 300] as const) {
        const ready: number[] = [],
          statusUpdates: number[] = [],
          navigationFrames: number[] = [];
        const idleFrames: number[] = [];
        for (let round = 0; round < rounds; round++) {
          const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
          const errors: string[] = [];
          page.on('pageerror', (error) => errors.push(error.message));
          let board = scenarioBoard(seed, buildScaleFixture(count));
          let delivered: FactoryV2Snapshot | undefined;
          let deliveryTime = 0;
          await page.route('**/api/v2/board', (route) => {
            if (board === delivered) return route.fulfill({ status: 304 });
            delivered = board;
            deliveryTime = performance.now();
            return route.fulfill({ json: board });
          });
          try {
            const start = performance.now();
            await page.goto(origin);
            await browserExpect(page.locator('.cc-item')).toHaveCount(count);
            await browserExpect(page.locator('.cc-item').first()).toBeVisible();
            await page.waitForFunction(
              () =>
                document.querySelectorAll('.cc-lines .cc-line').length > 0 &&
                document.querySelector('.cc-viewport')?.getAttribute('aria-busy') !== 'true'
            );
            ready.push(performance.now() - start);
            // Use browser source text so tsx's function-name helpers do not enter page evaluation.
            const frameSamples = async (navigate: boolean): Promise<number[]> =>
              page.evaluate(`
              new Promise(resolve => {
                const samples = []; let last; let frame = 0;
                function tick(now) {
                  if (last !== undefined) samples.push(now - last);
                  last = now;
                  if (${navigate}) document.querySelector(frame % 2 ? '[aria-label="Zoom out"]' : '[aria-label="Zoom in"]').click();
                  if (++frame < 121) requestAnimationFrame(tick); else resolve(samples);
                }
                requestAnimationFrame(tick);
              })
            `);
            idleFrames.push(...(await frameSamples(false)));
            navigationFrames.push(...(await frameSamples(true)));
            const item = Object.values(board.entities.items)[0];
            const label = `Benchmark status ${round}`;
            board = {
              ...board,
              entities: {
                ...board.entities,
                items: {
                  ...board.entities.items,
                  [item.id]: {
                    ...item,
                    version: `benchmark-${round}`,
                    status: { ...item.status, label },
                  },
                },
              },
            };
            await browserExpect(page.locator('.cc-status').filter({ hasText: label })).toHaveCount(
              1
            );
            statusUpdates.push(performance.now() - deliveryTime);
            if (errors.length) throw new Error(errors.join('\n'));
          } finally {
            await page.close();
          }
        }
        console.log(
          JSON.stringify({
            browser: browserName,
            items: count,
            rounds,
            // Development loading and host-side DOM observation include automation overhead.
            initialDisplay: summarize(ready),
            statusOnlyDOMPublication: summarize(statusUpdates),
            // Synthetic zoom clicks exercise React/transform work, not pointer hit testing.
            idleFrames: summarize(idleFrames),
            zoomFrames: summarize(navigationFrames),
          })
        );
      }
    } finally {
      await browser.close();
    }
  }
} finally {
  await vite.close();
}
