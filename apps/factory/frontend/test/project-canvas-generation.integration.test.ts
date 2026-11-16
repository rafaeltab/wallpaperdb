import { chromium, expect as browserExpect } from '@playwright/test';
import { createServer } from 'vite';
import { expect, it } from 'vitest';
import { fakeV2Server, type FactoryV2Snapshot } from '../../src/http/index.js';

it('publishes Project canvas geometry and item dependency links together after rapid interactions', async () => {
  const fake = fakeV2Server({ epoch: 'generation-browser' });
  const board = (await fake.inject('/api/v2/board')).json<FactoryV2Snapshot>();
  await fake.close();
  const blocker = board.entities.relationships['relationship:blocker'];
  if (blocker.kind !== 'prerequisite') throw new Error('Expected a prerequisite relationship');
  board.entities.relationships['relationship:unrelated'] = {
    ...blocker,
    id: 'relationship:unrelated',
    prerequisiteIssueId: 'issue:1001',
    dependantIssueId: 'issue:1005',
  };
  let served = board;
  const vite = await createServer({ configFile: 'frontend/vite.config.ts', server: { port: 0 } });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 800 },
      reducedMotion: 'reduce',
    });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/api/**', (route) => route.fulfill({ json: served }));
    // Run the actual bundled worker but hold its completion at the browser adapter.
    await page.addInitScript(() => {
      const ActualWorker = window.Worker;
      Object.defineProperty(window, 'Worker', {
        value: class extends EventTarget {
          actual: Worker;
          completions: unknown[] = [];
          release = () => {
            const result = this.completions.shift();
            if (result) this.dispatchEvent(new MessageEvent('message', { data: result }));
            document.documentElement.dataset.pendingLinkResults = String(this.completions.length);
          };
          constructor(url: string | URL, options?: WorkerOptions) {
            super();
            this.actual = new ActualWorker(url, options);
            this.actual.addEventListener('message', (event) => {
              this.completions.push(event.data);
              document.documentElement.dataset.pendingLinkResults = String(this.completions.length);
            });
            this.actual.addEventListener('error', () => this.dispatchEvent(new Event('error')));
            document.addEventListener('release-project-canvas', this.release);
          }
          postMessage(message: unknown) {
            document.documentElement.dataset.linkRequests = String(
              Number(document.documentElement.dataset.linkRequests ?? 0) + 1
            );
            this.actual.postMessage(message);
          }
          terminate() {
            this.actual.terminate();
            document.removeEventListener('release-project-canvas', this.release);
          }
        },
      });
    });
    await vite.listen();
    const origin = vite.resolvedUrls?.local[0];
    if (!origin) throw new Error('Missing Vite origin');
    await page.goto(origin);
    const viewport = page.locator('.cc-viewport');
    const waitForResult = () =>
      browserExpect
        .poll(() => page.evaluate(() => document.documentElement.dataset.pendingLinkResults))
        .toBe('1');
    const release = () =>
      page.evaluate(() => document.dispatchEvent(new Event('release-project-canvas')));
    await waitForResult();
    await browserExpect(page.getByRole('status')).toHaveText('Preparing Project canvas…');
    await release();
    await browserExpect(viewport).toHaveAttribute('aria-busy', 'false');
    const count = await page.locator('.cc-item').count();
    expect(count).toBeGreaterThan(0);
    const updated = board.entities.items['item:1001'];
    served = {
      ...board,
      entities: {
        ...board.entities,
        items: {
          ...board.entities.items,
          [updated.id]: {
            ...updated,
            version: 'new-version',
            status: { ...updated.status, label: 'Updated without layout' },
          },
        },
      },
    };
    await browserExpect(page.getByText('Updated without layout', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.dataset.linkRequests)).toBe('1');
    await browserExpect(viewport).toHaveAttribute('aria-busy', 'false');
    const before = await page.locator('.cc-world').innerHTML();
    const interaction = await page.evaluate(async () => {
      const element = document.querySelector('.cc-viewport');
      if (!element) throw new Error('Missing Project canvas viewport');
      const frames: number[] = [],
        handlers: number[] = [];
      let previous = performance.now();
      for (let index = 0; index < 30; index++) {
        await new Promise<void>((resolve) =>
          requestAnimationFrame((time) => {
            frames.push(time - previous);
            previous = time;
            resolve();
          })
        );
        const start = performance.now();
        element.dispatchEvent(
          new WheelEvent('wheel', {
            bubbles: true,
            cancelable: true,
            deltaY: index % 2 ? -1 : 1,
            clientX: 300,
            clientY: 300,
          })
        );
        handlers.push(performance.now() - start);
      }
      frames.sort((a, b) => a - b);
      handlers.sort((a, b) => a - b);
      return {
        samples: frames.length,
        frameMedianMs: frames[15],
        frameP95Ms: frames[28],
        handlerMedianMs: handlers[15],
        handlerP95Ms: handlers[28],
      };
    });
    console.log(JSON.stringify({ scenario: 'Project canvas wheel navigation', ...interaction }));
    expect(await page.locator('.cc-world').innerHTML()).toBe(before);
    await page.getByRole('button', { name: 'Collapse all sections', exact: true }).click();
    await waitForResult();
    await browserExpect(viewport).toHaveAttribute('aria-busy', 'true');
    expect(await page.locator('.cc-item').count()).toBe(count);
    await page.getByRole('button', { name: 'Expand all sections', exact: true }).click();
    await page.getByRole('button', { name: 'Collapse all sections', exact: true }).click();
    await release();
    await waitForResult();
    // The obsolete completion must leave both the old placement and old links visible.
    await browserExpect(viewport).toHaveAttribute('aria-busy', 'true');
    expect(await page.locator('.cc-item').count()).toBe(count);
    expect(await page.locator('.cc-world').innerHTML()).toBe(before);
    await release();
    await browserExpect(viewport).toHaveAttribute('aria-busy', 'false');
    await browserExpect(page.locator('.cc-item')).toHaveCount(0);
    await page.getByRole('button', { name: 'Expand all sections', exact: true }).click();
    await waitForResult();
    await release();
    await browserExpect(viewport).toHaveAttribute('aria-busy', 'false');
    const removedItem = page.getByRole('group', {
      name: 'Select Implement the command centre',
      exact: true,
    });
    const removedId = await removedItem.getAttribute('data-card');
    if (!removedId) throw new Error('Expected Project item identity');
    const incident = page.locator(
      `.cc-line[data-edge^="${removedId}-"],.cc-line[data-edge$="-${removedId}"]`
    );
    expect(await incident.count()).toBeGreaterThan(0);
    const surviving = await page.locator('.cc-line[data-edge]').evaluateAll((paths, id) => {
      const path = paths.find((value) => !value.getAttribute('data-edge')?.split('-').includes(id));
      return path ? { key: path.getAttribute('data-edge'), d: path.getAttribute('d') } : undefined;
    }, removedId);
    if (!surviving?.key || !surviving.d)
      throw new Error('Expected an unrelated item dependency link');
    await removedItem.click();
    await browserExpect(page.getByRole('toolbar', { name: 'Selected item actions' })).toBeVisible();
    const retainedItems = { ...served.entities.items };
    delete retainedItems['item:1002'];
    served = { ...served, entities: { ...served.entities, items: retainedItems } };
    await waitForResult();
    await browserExpect(incident).toHaveCount(0);
    await browserExpect(page.locator(`.cc-line[data-edge="${surviving.key}"]`)).toHaveAttribute(
      'd',
      surviving.d
    );
    await browserExpect(page.getByRole('toolbar', { name: 'Selected item actions' })).toHaveCount(
      0
    );
    await release();
    await browserExpect(viewport).toHaveAttribute('aria-busy', 'false');
    await browserExpect(page.locator('.cc-item')).toHaveCount(count - 1);
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
    await vite.close();
  }
}, 30000);
