import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect as browserExpect } from '@playwright/test';
import { createServer } from 'vite';
import { expect, it } from 'vitest';
import { fakeV2Server, type FactoryV2Snapshot } from '../../src/http/index.js';

it('provides keyboard and hover details, live switching and approved D layout at desktop and narrow widths', async () => {
  const backend = fakeV2Server({ epoch: 'activity-browser' });
  const previous = process.env.FACTORY_BACKEND_URL;
  const evidence =
    process.env.FACTORY_ACTIVITY_EVIDENCE ?? (await mkdtemp(join(tmpdir(), 'factory-activity-')));
  let vite: Awaited<ReturnType<typeof createServer>> | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    const seed = (await backend.inject('/api/v2/board')).json<FactoryV2Snapshot>();
    const idle: FactoryV2Snapshot = {
      ...seed,
      meta: {
        ...seed.meta,
        factory: { ...seed.meta.factory, paused: false },
        activity: {
          observedAt: new Date().toISOString(),
          items: [],
          coverage: [],
          uncertainty: [],
          admissionReasons: [],
        },
      },
    };
    const activity = idle.meta.activity;
    if (!activity) throw new Error('Expected activity fixture');
    let served = idle;
    let offline = false;
    await backend.listen({ host: '127.0.0.1', port: 0 });
    const address = backend.server.address();
    if (!address || typeof address === 'string') throw new Error('Missing address');
    process.env.FACTORY_BACKEND_URL = `http://127.0.0.1:${address.port}`;
    vite = await createServer({ configFile: 'frontend/vite.config.ts', server: { port: 0 } });
    await vite.listen();
    const origin = vite.resolvedUrls?.local[0];
    if (!origin) throw new Error('Missing Vite origin');
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      recordVideo: { dir: evidence },
    });
    const page = await context.newPage();
    await page.route('**/api/v2/board', (route) =>
      offline ? route.abort() : route.fulfill({ json: served })
    );
    page.on('pageerror', (error) => console.error(error));
    page.on('console', (message) => {
      if (message.type() === 'error') console.error(message.text());
    });
    await page.goto(origin);
    const trigger = page.locator('.fa-summary');
    const panel = page.getByRole('region', { name: 'Factory activity details' });
    await browserExpect(trigger).toContainText('Idle');
    await trigger.hover();
    await browserExpect(panel).toBeVisible();
    await browserExpect(panel.locator('.fa-row')).toHaveCount(12);
    await browserExpect(trigger.locator('.fa-dot')).toHaveCSS(
      'background-color',
      'rgb(212, 177, 125)'
    );
    await trigger.focus();
    await page.keyboard.press('Escape');
    await browserExpect(panel).not.toBeVisible();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    await browserExpect(panel).toBeVisible();
    const implementing = [1, 2].map((issue) => ({
      id: `implementation:${issue}`,
      category: 'implementing' as const,
      lifecycle: 'current' as const,
      issue,
      pullRequest: null,
      startedAt: new Date(Date.now() - (issue === 1 ? 120000 : 60000)).toISOString(),
      reason: 'Implementing admitted issue',
    }));
    served = { ...idle, meta: { ...idle.meta, activity: { ...activity, items: implementing } } };
    await browserExpect(trigger).toContainText('Implementing 2 issues', { timeout: 5000 });
    await page.screenshot({ path: join(evidence, 'implementing-two.png') });
    served = {
      ...idle,
      meta: { ...idle.meta, activity: { ...activity, items: [implementing[0]] } },
    };
    await browserExpect(trigger).toContainText('Implementing 1 issue', { timeout: 5000 });
    await browserExpect(trigger.locator('time')).toContainText('2m');
    served = {
      ...idle,
      meta: {
        ...idle.meta,
        activity: {
          ...activity,
          items: [implementing[0], { ...implementing[1], category: 'reviewing' }],
        },
      },
    };
    await browserExpect(trigger).toContainText('Reviewing 1 issue', { timeout: 5000 });
    await page.screenshot({ path: join(evidence, 'review-handoff.png') });
    const reviews = implementing.map((item) => ({
      ...item,
      id: `review:${item.issue}`,
      category: 'reviewing' as const,
    }));
    served = {
      ...idle,
      meta: { ...idle.meta, activity: { ...activity, items: [implementing[0], ...reviews] } },
    };
    await browserExpect(trigger).toContainText('Reviewing 2 issues', { timeout: 5000 });
    const reviewTile = panel.locator('.fa-row').filter({ hasText: 'Reviewing' });
    await browserExpect(reviewTile.getByRole('img', { name: 'Active', exact: true })).toBeVisible();
    await browserExpect(reviewTile).toContainText('2 issues');
    await browserExpect(trigger.locator('time')).toContainText('1m');
    await page.screenshot({ path: join(evidence, 'reviewing-two.png') });
    served = {
      ...idle,
      meta: { ...idle.meta, activity: { ...activity, items: [implementing[0], reviews[0]] } },
    };
    await browserExpect(trigger).toContainText('Reviewing 1 issue', { timeout: 5000 });
    await browserExpect(trigger.locator('time')).toContainText('2m');
    await page.screenshot({ path: join(evidence, 'reviewing-newest-departed.png') });

    served = {
      ...idle,
      meta: {
        ...idle.meta,
        activity: {
          ...activity,
          items: [
            {
              id: 'gathering:live',
              category: 'gathering-planning-context',
              lifecycle: 'current',
              startedAt: new Date(Date.now() - 9000).toISOString(),
              issue: null,
              pullRequest: null,
              reason: 'Collecting initial planning inputs',
            },
          ],
        },
      },
    };
    await browserExpect(trigger).toContainText('Gathering planning context', { timeout: 5000 });
    await browserExpect(trigger.locator('.fa-dot')).toHaveCSS('animation-name', 'fa-blink');
    served = {
      ...served,
      meta: {
        ...served.meta,
        activity: {
          ...activity,
          items: [
            {
              id: 't3:live',
              category: 'refreshing-t3',
              lifecycle: 'current',
              startedAt: new Date(Date.now() - 9000).toISOString(),
              issue: null,
              pullRequest: null,
              reason: 'Reading routine T3 thread metadata',
            },
          ],
        },
      },
    };
    await browserExpect(trigger).toContainText('Refreshing T3 information', { timeout: 5000 });
    const t3Tile = panel.locator('.fa-row').filter({ hasText: 'Refreshing T3 information' });
    await browserExpect(t3Tile.getByRole('img', { name: 'Active', exact: true })).toBeVisible();
    await browserExpect(t3Tile).toContainText('1 operation');
    await browserExpect(
      panel
        .locator('.fa-row')
        .filter({ hasText: 'Refreshing GitHub' })
        .getByRole('img', { name: 'Inactive', exact: true })
    ).toBeVisible();
    await browserExpect(trigger).toHaveCSS('font-size', '11px');
    await browserExpect(trigger.locator('time')).toHaveCSS('color', 'rgb(131, 131, 144)');
    await browserExpect(panel.locator('.fa-rows')).toHaveCSS(
      'grid-template-columns',
      '172px 172px'
    );
    await page.screenshot({ path: join(evidence, 'activity-desktop.png') });
    const github = served;
    served = {
      ...github,
      meta: {
        ...github.meta,
        activity: {
          ...activity,
          items: [
            ...(github.meta.activity?.items ?? []),
            {
              id: 'verification:live',
              category: 'checking-plan-freshness',
              lifecycle: 'current',
              startedAt: new Date(Date.now() - 2000).toISOString(),
              issue: null,
              pullRequest: null,
              reason: 'Verifying selected prerequisites using the collected planning snapshot',
            },
          ],
        },
      },
    };
    await browserExpect(trigger).toContainText('Checking plan freshness', { timeout: 5000 });
    const verification = panel.getByTitle(
      'Verifying selected prerequisites using the collected planning snapshot'
    );
    await browserExpect(verification).toContainText('1 operation');
    await browserExpect(
      verification.getByRole('img', { name: 'Active', exact: true })
    ).toBeVisible();
    await page.screenshot({ path: join(evidence, 'activity-verification.png') });
    served = github;
    await browserExpect(trigger).toContainText('Refreshing T3 information', { timeout: 5000 });
    await trigger.click();
    await page.mouse.move(1200, 700);
    await browserExpect(panel).toBeVisible();
    await page.mouse.click(1200, 700);
    await browserExpect(panel).not.toBeVisible();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await browserExpect(trigger.locator('.fa-dot')).toHaveCSS('animation-name', 'none');
    for (const width of [900, 320]) {
      await page.setViewportSize({ width, height: 800 });
      await trigger.hover();
      await browserExpect(panel).toBeVisible();
      const bounds = await panel.boundingBox();
      expect(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width).toBe(true);
      await page.screenshot({ path: join(evidence, `activity-${width}.png`) });
    }
    served = {
      ...idle,
      meta: {
        ...idle.meta,
        activity: {
          ...activity,
          items: [
            {
              id: 'ci:1',
              category: 'waiting-for-ci',
              lifecycle: 'current',
              issue: 1,
              pullRequest: 10,
              startedAt: new Date(Date.now() - 65000).toISOString(),
              reason: 'Managed CI observation',
            },
            {
              id: 'ci:2',
              category: 'waiting-for-ci',
              lifecycle: 'current',
              issue: 2,
              pullRequest: 11,
              startedAt: new Date(Date.now() - 10000).toISOString(),
              reason: 'Managed GitHub wait',
            },
          ],
        },
      },
    };
    await browserExpect(trigger).toContainText('Waiting for CI 2 issues', { timeout: 5000 });
    await trigger.hover();
    await browserExpect(panel).toContainText('2 issues');
    await page.screenshot({ path: join(evidence, 'activity-ci-waits.png') });
    served = {
      ...served,
      meta: {
        ...served.meta,
        activity: { ...activity, items: served.meta.activity?.items.slice(0, 1) ?? [] },
      },
    };
    await browserExpect(trigger).toContainText('Waiting for CI 1 issue', { timeout: 5000 });
    await browserExpect(trigger.locator('time')).toContainText('1m');
    await page.screenshot({ path: join(evidence, 'activity-ci-remaining.png') });
    served = {
      ...served,
      meta: { ...served.meta, factory: { ...served.meta.factory, paused: true } },
    };
    await browserExpect(trigger.locator('.fa-dot')).toHaveCSS(
      'background-color',
      'rgb(131, 131, 144)',
      { timeout: 5000 }
    );
    await browserExpect(trigger).toContainText('Waiting for CI 1 issue');
    served = {
      ...idle,
      meta: { ...idle.meta, activity: { ...activity, uncertainty: ['Execution unknown'] } },
    };
    await browserExpect(trigger).toContainText('Status unknown', { timeout: 5000 });
    await page.screenshot({ path: join(evidence, 'activity-unknown.png') });
    offline = true;
    await browserExpect(trigger).toContainText('Disconnected', { timeout: 15000 });
    await trigger.hover();
    await browserExpect(panel).toContainText('last known data');
    await page.screenshot({ path: join(evidence, 'activity-disconnected.png') });
    offline = false;
    served = idle;
    await browserExpect(trigger).toContainText('Idle', { timeout: 5000 });
    await trigger.hover();
    await browserExpect(panel).not.toContainText('last known data');
    await page.screenshot({ path: join(evidence, 'activity-recovered.png') });
    await context.close();
  } finally {
    await browser?.close();
    await vite?.close();
    await backend.close();
    if (previous === undefined) delete process.env.FACTORY_BACKEND_URL;
    else process.env.FACTORY_BACKEND_URL = previous;
  }
}, 60000);
