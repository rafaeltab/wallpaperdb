import { mkdir } from 'node:fs/promises';
import { chromium, expect as browserExpect } from '@playwright/test';
import { createServer } from 'vite';
import { expect, it } from 'vitest';
import { fakeV2Server } from '../../src/http/index.js';
it('uses the canvas and every command flow against the real fake v2 HTTP server', async () => {
  const backend = fakeV2Server({ epoch: 'browser' });
  await backend.listen({ host: '127.0.0.1', port: 0 });
  const address = backend.server.address();
  if (!address || typeof address === 'string') throw new Error('Missing backend address');
  const previous = process.env.FACTORY_BACKEND_URL;
  process.env.FACTORY_BACKEND_URL = `http://127.0.0.1:${address.port}`;
  const vite = await createServer({ configFile: 'frontend/vite.config.ts', server: { port: 0 } });
  const browser = await chromium.launch({ headless: true });
  const directory = process.env.FACTORY_DEMO_DIRECTORY;
  if (directory) await mkdir(directory, { recursive: true });
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    recordVideo: directory ? { dir: directory, size: { width: 1600, height: 1000 } } : undefined,
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    await vite.listen();
    const origin = vite.resolvedUrls?.local[0];
    if (!origin) throw new Error('Missing Vite origin');
    await page.goto(origin);
    await browserExpect(page.getByText('Fake data · commands are simulated')).toBeVisible();
    // These measurements distinguish the selected prototype from the rejected redesign.
    expect(
      await page.locator('.cc-toolbar').evaluate((el) => el.getBoundingClientRect().height)
    ).toBe(44);
    expect(await page.locator('.cc-world').evaluate((el) => getComputedStyle(el).transform)).toBe(
      'matrix(0.9, 0, 0, 0.9, 12, 12)'
    );
    expect(
      await page
        .locator('.cc-issue-card')
        .first()
        .evaluate((el) => getComputedStyle(el).width)
    ).toBe('384px');
    await page.getByRole('button', { name: 'Fit all nodes', exact: true }).click();
    await browserExpect(
      page.getByRole('button', { name: 'Highlight 2 items needing human attention', exact: true })
    ).toBeVisible();
    expect(await page.getByRole('button', { name: 'Design variants' }).count()).toBe(0);
    await page
      .getByRole('button', { name: 'Highlight 2 items needing human attention', exact: true })
      .click();
    expect(await page.locator('.cc-item.cc-selected').count()).toBe(2);
    await page
      .getByRole('button', { name: 'Highlight 2 items needing human attention', exact: true })
      .click();
    await page.locator('.cc-parent-head[data-card]').first().click();
    await browserExpect(page.getByRole('toolbar', { name: 'Selected item actions' })).toBeVisible();
    expect(await page.locator('.cc-parent-focused').count()).toBe(1);
    await page.keyboard.press('Escape');
    const planned = page.locator('[data-area=planned]');
    await planned.getByRole('button', { name: 'Collapse all Planned', exact: true }).click();
    expect(await page.locator('.cc-item').count()).toBe(5);
    await planned.getByRole('button', { name: 'Expand all Planned', exact: true }).click();
    await page.getByRole('button', { name: 'Factory settings', exact: true }).click();
    const settings = page.getByRole('dialog', { name: 'Factory controls' });
    await settings.getByLabel('Concurrency', { exact: true }).fill('5');
    await settings.getByLabel('Admission allowance', { exact: true }).fill('12');
    await settings.getByRole('button', { name: 'Apply controls' }).click();
    await browserExpect(page.getByText('Command succeeded', { exact: true })).toBeVisible();
    await settings.getByRole('button', { name: 'Close Factory controls' }).click();
    await page.getByRole('button', { name: 'Factory settings', exact: true }).click();
    await browserExpect(settings.getByLabel('Concurrency', { exact: true })).toHaveValue('5');
    await settings.getByRole('button', { name: 'Close Factory controls' }).click();
    await page.getByRole('button', { name: '◇ Preview plan', exact: true }).click();
    const plan = page.getByRole('dialog', { name: 'Plan preview' });
    await plan.getByRole('button', { name: 'Generate plan preview' }).click();
    await browserExpect(plan.getByRole('heading', { name: 'Proposed work' })).toBeVisible();
    await browserExpect(page.getByText('Command succeeded', { exact: true })).toBeVisible();
    if (directory) await page.screenshot({ path: `${directory}/factory-plan.png` });
    await plan.getByRole('button', { name: 'Close Plan preview' }).click();
    await page.getByRole('button', { name: '+ Start issue', exact: true }).click();
    const start = page.getByRole('dialog', { name: 'Start an issue' });
    await start.getByLabel('Search issues').fill('1001');
    await start
      .getByRole('button', { name: '#1001 Add a searchable issue list', exact: true })
      .click();
    await start.getByLabel('Execution context').fill('Implement the selected issue');
    await start.getByRole('button', { name: 'Start selected issue', exact: true }).click();
    await browserExpect(page.getByText('Command succeeded', { exact: true })).toBeVisible();
    await start.getByRole('button', { name: 'Close Start an issue' }).click();
    await page.getByRole('button', { name: 'Factory settings', exact: true }).click();
    await browserExpect(settings.getByText(/5 distinct admissions consumed/)).toBeVisible();
    await settings.getByRole('button', { name: 'Close Factory controls' }).click();
    await page.getByRole('button', { name: 'Fit all nodes', exact: true }).click();
    await page.locator('.cc-item').filter({ hasText: 'Reconcile a paused worker' }).click();
    await page.getByRole('button', { name: 'Details', exact: true }).click();
    const details = page.getByRole('dialog', { name: 'Work item details' });
    await browserExpect(
      details.getByRole('heading', { name: 'Reconcile a paused worker' })
    ).toBeVisible();
    await browserExpect(details.getByText('Loading versioned details…')).toHaveCount(0);
    await details.getByRole('button', { name: 'Resume job', exact: true }).click();
    await browserExpect(page.getByText('Command succeeded', { exact: true })).toBeVisible();
    await details.getByRole('button', { name: 'Close Work item details' }).click();
    await page.getByRole('button', { name: 'Cancel job', exact: true }).click();
    await page
      .getByRole('dialog', { name: 'Cancel job' })
      .getByRole('button', { name: 'Confirm cancellation' })
      .click();
    await browserExpect(page.getByText('Command succeeded', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Factory settings', exact: true }).click();
    await browserExpect(settings.getByText(/5 distinct admissions consumed/)).toBeVisible();
    await settings.getByRole('button', { name: 'Close Factory controls' }).click();
    if (directory) await page.screenshot({ path: `${directory}/factory-canvas.png` });
    expect(errors).toEqual([]);
  } catch (error) {
    console.error({ errors, body: await page.locator('body').innerText() });
    if (directory) await page.screenshot({ path: `${directory}/failure.png` });
    throw error;
  } finally {
    await context.close();
    await browser.close();
    await vite.close();
    await backend.close();
    if (previous === undefined) delete process.env.FACTORY_BACKEND_URL;
    else process.env.FACTORY_BACKEND_URL = previous;
  }
}, 60000);

it('renders the archived scale scenarios through the public v2 data model', async () => {
  const { buildScaleFixture } = await import('./fixtures/canvas/factory-scale-fixture');
  const { scenarioBoard } = await import('./fixtures/canvas/board');
  const backend = fakeV2Server({ epoch: 'scale-browser' });
  const seed = (await backend.inject('/api/v2/board')).json<
    import('../../src/http/index.js').FactoryV2Snapshot
  >();
  const vite = await createServer({ configFile: 'frontend/vite.config.ts', server: { port: 0 } });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1000 },
    reducedMotion: 'reduce',
  });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    await vite.listen();
    const origin = vite.resolvedUrls?.local[0];
    if (!origin) throw new Error('Missing Vite origin');
    for (const count of [100, 200, 300] as const) {
      const fixture = buildScaleFixture(count),
        board = scenarioBoard(seed, fixture);
      await page.unroute('**/api/v2/board');
      await page.route('**/api/v2/board', (route) => route.fulfill({ json: board }));
      await page.goto(origin);
      await browserExpect(page.locator('.cc-item')).toHaveCount(count);
      expect(
        await page
          .locator('.cc-issue-card')
          .first()
          .evaluate((el) => getComputedStyle(el).width)
      ).toBe('384px');
      expect(
        await page
          .locator('.cc-pr-panel')
          .first()
          .evaluate((el) => getComputedStyle(el).width)
      ).toBe('768px');
      expect(
        await page
          .locator('.cc-pr-row')
          .first()
          .evaluate((el) => getComputedStyle(el).height)
      ).toBe('56px');
      expect(
        await page
          .locator('.cc-title')
          .first()
          .evaluate((el) => getComputedStyle(el).fontSize)
      ).toBe('13px');
      expect(await page.locator('.cc-app').getAttribute('class')).toContain(
        'cc-highlight-status-glow'
      );
      const xs = await page
        .locator('.cc-pr-panel')
        .evaluateAll((panels) => [
          ...new Set(panels.map((panel) => (panel instanceof HTMLElement ? panel.style.left : ''))),
        ]);
      expect(xs).toHaveLength(3);
      await page.getByRole('button', { name: 'Fit all nodes' }).click();
      if (process.env.FACTORY_DEMO_DIRECTORY)
        await page.screenshot({ path: `${process.env.FACTORY_DEMO_DIRECTORY}/scale-${count}.png` });
      await page.getByRole('button', { name: 'Collapse all sections' }).click();
      await browserExpect(page.locator('.cc-item')).toHaveCount(0);
      await page.getByRole('button', { name: 'Expand all sections' }).click();
      await browserExpect(page.locator('.cc-item')).toHaveCount(count);
    }
    expect(errors).toEqual([]);
  } finally {
    await page.close();
    await browser.close();
    await vite.close();
    await backend.close();
  }
}, 60000);
