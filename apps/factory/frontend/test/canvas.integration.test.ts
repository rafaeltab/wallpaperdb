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
    recordVideo: directory ? { dir: directory } : undefined,
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
    await page.getByRole('button', { name: 'Fit all', exact: true }).click();
    await browserExpect(
      page.getByRole('button', { name: '2 need attention', exact: true })
    ).toBeVisible();
    expect(await page.getByRole('button', { name: 'Design variants' }).count()).toBe(0);
    await page.getByRole('button', { name: '2 need attention', exact: true }).click();
    expect(await page.locator('.fc-card.fc-highlight').count()).toBe(2);
    await page.getByRole('button', { name: '2 need attention', exact: true }).click();
    await page.locator('.fc-group-name').first().click();
    await browserExpect(
      page.getByRole('toolbar', { name: 'Selected group actions' })
    ).toBeVisible();
    expect(await page.locator('.fc-selected-group').count()).toBe(1);
    await page.getByRole('button', { name: 'Clear selection', exact: true }).click();
    const planned = page.getByRole('region', { name: 'Planned', exact: true });
    await planned.getByRole('button', { name: 'Collapse all', exact: true }).click();
    expect(await page.locator('.fc-card').count()).toBe(5);
    await planned.getByRole('button', { name: 'Expand all', exact: true }).click();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const settings = page.getByRole('dialog', { name: 'Factory controls' });
    await settings.getByLabel('Concurrency', { exact: true }).fill('5');
    await settings.getByLabel('Admission allowance', { exact: true }).fill('12');
    await settings.getByRole('button', { name: 'Apply controls' }).click();
    await browserExpect(page.getByText('Command succeeded', { exact: true })).toBeVisible();
    await settings.getByRole('button', { name: 'Close Factory controls' }).click();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await browserExpect(settings.getByLabel('Concurrency', { exact: true })).toHaveValue('5');
    await settings.getByRole('button', { name: 'Close Factory controls' }).click();
    await page.getByRole('button', { name: 'Plan preview', exact: true }).click();
    const plan = page.getByRole('dialog', { name: 'Plan preview' });
    await plan.getByRole('button', { name: 'Generate plan preview' }).click();
    await browserExpect(plan.getByRole('heading', { name: 'Proposed work' })).toBeVisible();
    await browserExpect(page.getByText('Command succeeded', { exact: true })).toBeVisible();
    if (directory) await page.screenshot({ path: `${directory}/factory-plan.png` });
    await plan.getByRole('button', { name: 'Close Plan preview' }).click();
    await page.getByRole('button', { name: 'Start issue', exact: true }).click();
    const start = page.getByRole('dialog', { name: 'Start an issue' });
    await start.getByLabel('Search issues').fill('1001');
    await start
      .getByRole('button', { name: '#1001 Add a searchable issue list', exact: true })
      .click();
    await start.getByLabel('Execution context').fill('Implement the selected issue');
    await start.getByRole('button', { name: 'Start selected issue', exact: true }).click();
    await browserExpect(page.getByText('Command succeeded', { exact: true })).toBeVisible();
    await start.getByRole('button', { name: 'Close Start an issue' }).click();
    await browserExpect(page.getByText('5 admitted', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'Fit all', exact: true }).click();
    await page.locator('.fc-card').filter({ hasText: 'Reconcile a paused worker' }).click();
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
    await browserExpect(page.getByText('5 admitted', { exact: false })).toBeVisible();
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
}, 30000);
