import { mkdir } from 'node:fs/promises';
import { chromium, expect as browserExpect } from '@playwright/test';
import { createServer } from 'vite';
import { expect, it } from 'vitest';
import { fakeV2Server, type FactoryV2Snapshot } from '../../src/http/index.js';
import { issueRoutingBoard } from './fixtures/canvas/issue-routing';

it('keeps empty section controls readable within heading clearance across title modes and zoom', async () => {
  const fake = fakeV2Server({ epoch: 'heading-browser' });
  const seed = (await fake.inject('/api/v2/board')).json<FactoryV2Snapshot>();
  await fake.close();
  const value = issueRoutingBoard(seed);
  const vite = await createServer({ configFile: 'frontend/vite.config.ts', server: { port: 0 } });
  const browser = await chromium.launch({ headless: true });
  const directory = process.env.FACTORY_DEMO_DIRECTORY;
  if (directory) await mkdir(directory, { recursive: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    reducedMotion: 'reduce',
    recordVideo: directory ? { dir: directory, size: { width: 1280, height: 800 } } : undefined,
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  let empty = false;
  await page.route('**/api/**', (route) => {
    const request = route.request();
    if (request.method() === 'GET' && new URL(request.url()).pathname === '/api/v2/board')
      return route.fulfill({
        json: empty ? { ...value, entities: { ...value.entities, items: {} } } : value,
      });
    return route.abort();
  });
  try {
    await vite.listen();
    const origin = vite.resolvedUrls?.local[0];
    if (!origin) throw new Error('No Vite origin');
    for (const titles of ['ellipsis', 'wrap', 'expand'])
      for (const width of [1280, 480, 320])
        for (const allEmpty of [false, true]) {
          empty = allEmpty;
          await page.setViewportSize({ width, height: 800 });
          await page.goto(`${origin}?titles=${titles}`);
          await browserExpect(page.locator('[data-area=working] h2')).toContainText('Working0');
          // A visible DOM node can precede passive keyboard-effect installation.
          // Focus the actual canvas through a stable browser action before shortcuts.
          await page.locator('.cc-viewport').click({ position: { x: 3, y: 3 } });
          await page.keyboard.press('f');
          await browserExpect(page.locator('.cc-world')).not.toHaveCSS(
            'transform',
            'matrix(0.9, 0, 0, 0.9, 12, 12)'
          );
          for (const zoom of ['fit', 'in']) {
            if (zoom === 'in') {
              const fittedTransform = await page
                .locator('.cc-world')
                .evaluate((el) => getComputedStyle(el).transform);
              await page.keyboard.press('=');
              await browserExpect(page.locator('.cc-world')).not.toHaveCSS(
                'transform',
                fittedTransform
              );
            }
            const headings = await page.locator('.cc-area h2').evaluateAll((elements) =>
              elements.map((heading) => {
                const bounds = heading.getBoundingClientRect();
                const world = document.querySelector('.cc-world');
                if (!world) throw new Error('Expected canvas world');
                const origin = world.getBoundingClientRect(),
                  scale = new DOMMatrix(getComputedStyle(world).transform).a;
                const buttons = Array.from(heading.querySelectorAll('button'), (button) => {
                  const rect = button.getBoundingClientRect();
                  const texts = Array.from(button.childNodes)
                    .filter((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim())
                    .flatMap((node) => {
                      const range = document.createRange();
                      range.selectNodeContents(node);
                      return Array.from(range.getClientRects(), (r) => ({
                        left: r.left,
                        right: r.right,
                        top: r.top,
                        bottom: r.bottom,
                      }));
                    });
                  return {
                    left: rect.left,
                    right: rect.right,
                    top: rect.top,
                    bottom: rect.bottom,
                    texts,
                  };
                });
                return {
                  logicalLeft: (bounds.left - origin.left) / scale,
                  logicalRight: (bounds.right - origin.left) / scale,
                  logicalHeight: bounds.height / scale,
                  left: bounds.left,
                  right: bounds.right,
                  top: bounds.top,
                  bottom: bounds.bottom,
                  buttons,
                };
              })
            );
            for (const heading of headings) {
              expect(heading.logicalLeft).toBeGreaterThanOrEqual(20 - 0.5);
              expect(heading.logicalRight).toBeLessThanOrEqual(330 + 0.5);
              expect(heading.logicalHeight).toBeLessThanOrEqual(20 + 0.5);
              for (const button of heading.buttons) {
                expect(button.texts).toHaveLength(1);
                expect(button.texts[0].left).toBeGreaterThanOrEqual(button.left - 0.5);
                expect(button.texts[0].right).toBeLessThanOrEqual(button.right + 0.5);
                expect(button.top).toBeGreaterThanOrEqual(heading.top - 0.5);
                expect(button.bottom).toBeLessThanOrEqual(heading.bottom + 0.5);
              }
              expect(heading.buttons[0].right).toBeLessThanOrEqual(heading.buttons[1].left);
              if (allEmpty) {
                expect(heading.left).toBeGreaterThanOrEqual(0);
                expect(heading.right).toBeLessThanOrEqual(width);
              }
            }
          }
          if (!allEmpty && width === 1280) {
            await page.keyboard.press('f');
            const source = page.locator('.cc-item[aria-label="Select Issue 250"]');
            const target = page.locator('.cc-item[aria-label="Select Issue 461"]');
            const sourceId = await source.getAttribute('data-card'),
              targetId = await target.getAttribute('data-card');
            const connection = page.locator(`[data-edge="${sourceId}-${targetId}"]`);
            await browserExpect(connection).toHaveAttribute('data-failed', 'false');
            const points: { x: number; y: number }[] = JSON.parse(
              (await connection.getAttribute('data-points')) ?? '[]'
            );
            expect(points.length).toBeGreaterThan(2);
            expect(
              points
                .slice(1)
                .every((point, index) => point.x === points[index].x || point.y === points[index].y)
            ).toBe(true);
            await page.getByRole('button', { name: 'Collapse all Planned', exact: true }).click();
            await browserExpect(page.locator('.cc-item')).toHaveCount(0);
            await page.getByRole('button', { name: 'Expand all Planned', exact: true }).click();
            await browserExpect(page.locator('.cc-item')).toHaveCount(5);
            if (directory && titles === 'ellipsis') {
              await source.click();
              await page.screenshot({ path: `${directory}/canvas-heading-and-routes.png` });
            }
          }
        }
    expect(errors).toEqual([]);
  } finally {
    await context.close();
    await browser.close();
    await vite.close();
  }
}, 60000);
