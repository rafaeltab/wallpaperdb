import { Effect } from 'effect';
import { chromium, expect as browserExpect } from '@playwright/test';
import { createServer } from 'vite';
import { expect, it } from 'vitest';
import { operationsServer } from '../../src/http/index.js';
import type { ScheduleSnapshot } from '../src/api';

it('serves the real React app over Vite HMR, proxies same-origin browser POSTs and rejects foreign origins in both modes', async () => {
  let snapshot: ScheduleSnapshot = {
    state: { revision: 1, concurrency: 1, allowance: 1, paused: true, admissions: [] },
    jobs: [],
    localWork: [],
    observations: { state: 'loading', stale: true },
  };
  const unavailable = () => Effect.die('No external work authorized');
  const id = '65361fc1-cee7-46c7-aefb-6bfbf75d1824';
  let phase = 'discovery';
  let commands = 0;
  const app = operationsServer({
    base: 'a'.repeat(40),
    run: Effect.runPromise,
    snapshot: () => Effect.succeed(snapshot),
    job: { status: unavailable, start: unavailable, resume: unavailable, cancel: unavailable },
    scheduler: {
      status: unavailable,
      tick: unavailable,
      authorizeRecovery: unavailable,
      start: unavailable,
      resume: unavailable,
      cancel: unavailable,
      configure: (command) =>
        Effect.sync(() => {
          if (command.revision !== snapshot.state.revision) return 'conflict' as const;
          snapshot = {
            ...snapshot,
            state: { ...snapshot.state, ...command, revision: command.revision + 1 },
          };
          commands++;
          return 'saved' as const;
        }),
    },
    attempts: {
      submit: async () => ({ kind: 'accepted', id }),
      observe: async () => ({
        id,
        phase,
        elapsedMs: 2500,
        detail: phase === 'failed' ? 'Freshness unavailable' : undefined,
        result:
          phase === 'succeeded'
            ? { kind: 'stale', input: { issues: [] }, selected: [], rejected: [] }
            : undefined,
      }),
    },
  });
  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address();
  if (!address || typeof address === 'string') throw new Error('Missing address');
  const backend = `http://127.0.0.1:${address.port}`;
  const previous = process.env.FACTORY_BACKEND_URL;
  process.env.FACTORY_BACKEND_URL = backend;
  const vite = await createServer({ configFile: 'frontend/vite.config.ts', server: { port: 0 } });
  const browser = await chromium.launch({ headless: true });
  try {
    await vite.listen();
    const origin = vite.resolvedUrls?.local[0];
    if (!origin) throw new Error('Missing dev URL');
    expect((await fetch(`${origin}@vite/client`)).status).toBe(200);
    const page = await browser.newPage();
    await page.goto(origin);
    await browserExpect(page.getByRole('heading', { name: 'Factory operations' })).toBeVisible();
    await browserExpect(page.getByText('GitHub: loading (stale).')).toBeVisible();
    await page.getByLabel('Concurrency').fill('3');
    // A newer observation must not silently rebase a dirty draft.
    snapshot = { ...snapshot, state: { ...snapshot.state, revision: 2 } };
    await browserExpect(
      page.getByText('Editing revision 1. Latest observed revision 2.')
    ).toBeVisible();
    await page.getByRole('button', { name: 'Save scheduler controls' }).click();
    await browserExpect(page.locator('#result')).toContainText('Controls changed');
    expect(commands).toBe(0);
    await page.getByRole('button', { name: 'Use latest controls' }).click();
    await page.getByLabel('Concurrency').fill('3');
    await page.getByRole('button', { name: 'Save scheduler controls' }).click();
    await browserExpect(
      page.getByText('Editing revision 3. Latest observed revision 3.')
    ).toBeVisible();
    expect(commands).toBe(1);
    expect(snapshot.state.concurrency).toBe(3);
    await page.getByRole('button', { name: 'Generate plan preview' }).click();
    await browserExpect(page.getByText('Gathering issues (3s)')).toBeVisible();
    await browserExpect(page.getByRole('progressbar')).toHaveAttribute('value', '1');
    phase = 'handoff';
    await browserExpect(page.getByText('Handing off to planner (3s)')).toBeVisible();
    phase = 'freshness';
    await browserExpect(page.getByText('Validating freshness (3s)')).toBeVisible();
    phase = 'succeeded';
    await browserExpect(page.getByText('Stale proposal. Generate a fresh preview.')).toBeVisible();
    await browserExpect(page.getByText('No work was dispatched.')).toBeVisible();
    phase = 'failed';
    await page.getByRole('button', { name: 'Generate plan preview' }).click();
    await browserExpect(page.getByText('Preview failed (3s)')).toBeVisible();
    await browserExpect(page.getByText('Freshness unavailable')).toBeVisible();
    for (const target of [origin, `${backend}/`]) {
      const response = await fetch(`${target}api/scheduler`, {
        method: 'POST',
        headers: { origin: 'https://foreign.test', 'content-type': 'application/json' },
        body: JSON.stringify({ revision: 3, concurrency: 7, allowance: 1, paused: true }),
      });
      expect(response.status).toBe(403);
    }
    expect(commands).toBe(1);
    // Packaged same-origin assets run without the dev server.
    await vite.close();
    await page.goto(backend);
    await browserExpect(page.getByRole('heading', { name: 'Factory operations' })).toBeVisible();
    await page.getByLabel('Concurrency').fill('4');
    await page.getByRole('button', { name: 'Save scheduler controls' }).click();
    await browserExpect(
      page.getByText('Editing revision 4. Latest observed revision 4.')
    ).toBeVisible();
    expect(commands).toBe(2);
  } finally {
    await browser.close();
    await vite.close();
    await app.close();
    if (previous === undefined) delete process.env.FACTORY_BACKEND_URL;
    else process.env.FACTORY_BACKEND_URL = previous;
  }
});
