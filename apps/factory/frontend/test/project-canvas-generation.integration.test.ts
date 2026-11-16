import { chromium, expect as browserExpect, type ElementHandle } from '@playwright/test';
import { createServer } from 'vite';
import { expect, it } from 'vitest';
import { fakeV2Server, type FactoryV2Snapshot } from '../../src/http/index.js';

function observeAttributes(link: ElementHandle<SVGElement | HTMLElement>) {
  return link.evaluateHandle((element) => {
    const mutations: string[] = [];
    const observer = new MutationObserver((records) => {
      for (const record of records) mutations.push(record.attributeName ?? 'unknown');
    });
    observer.observe(element, { attributes: true });
    return { mutations, observer };
  });
}

it('publishes current Project items before progressive links and ignores obsolete routing results', async () => {
  const fake = fakeV2Server({ epoch: 'generation-browser' });
  const seed = (await fake.inject('/api/v2/board')).json<FactoryV2Snapshot>();
  await fake.close();
  const blocker = seed.entities.relationships['relationship:blocker'];
  if (blocker.kind !== 'prerequisite') throw new Error('Expected a prerequisite relationship');
  const board: FactoryV2Snapshot = {
    ...seed,
    entities: {
      ...seed.entities,
      relationships: {
        'relationship:unrelated': {
          ...blocker,
          id: 'relationship:unrelated',
          prerequisiteIssueId: 'issue:1001',
          // Planned endpoints stay in place when the Working item is deleted below.
          dependantIssueId: 'issue:1000',
        },
        // Keep its route/color index stable when the later incident link disappears.
        ...seed.entities.relationships,
      },
    },
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
    // Run the bundled worker and control publication of its real progress/final messages.
    await page.addInitScript(() => {
      type Result = { id: number; progress?: unknown[]; links?: unknown[]; error?: string };
      const ActualWorker = window.Worker;
      Object.defineProperty(window, 'Worker', {
        value: class extends EventTarget {
          actual: Worker;
          completions: Result[] = [];
          released: Result[] = [];
          update = () => {
            document.documentElement.dataset.pendingLinkResults = String(this.completions.length);
            document.documentElement.dataset.pendingLinkFinals = JSON.stringify(
              this.completions
                .filter((result) => 'links' in result || 'error' in result)
                .map((result) => result.id)
            );
          };
          release = (event: Event) => {
            const { id, mode } = (
              event as CustomEvent<{ id: number; mode: 'progress' | 'all' | 'replay' }>
            ).detail;
            if (mode === 'replay') {
              for (const result of this.released.filter((result) => result.id === id))
                this.dispatchEvent(new MessageEvent('message', { data: result }));
            } else {
              const pending =
                mode === 'progress'
                  ? this.completions
                      .filter((result) => result.id === id && 'progress' in result)
                      .slice(0, 1)
                  : this.completions.filter((result) => result.id === id);
              for (const result of pending) {
                this.completions.splice(this.completions.indexOf(result), 1);
                this.released.push(result);
                this.dispatchEvent(new MessageEvent('message', { data: result }));
              }
            }
            this.update();
          };
          constructor(url: string | URL, options?: WorkerOptions) {
            super();
            this.actual = new ActualWorker(url, options);
            this.actual.addEventListener('message', (event) => {
              this.completions.push(event.data);
              this.update();
            });
            this.actual.addEventListener('error', () => this.dispatchEvent(new Event('error')));
            document.addEventListener('release-project-canvas', this.release);
          }
          postMessage(message: { id: number }) {
            document.documentElement.dataset.linkRequests = String(
              Number(document.documentElement.dataset.linkRequests ?? 0) + 1
            );
            document.documentElement.dataset.lastLinkRequest = String(message.id);
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
    const waitForResult = (id: number) =>
      browserExpect
        .poll(() =>
          page.evaluate(
            (id) =>
              JSON.parse(document.documentElement.dataset.pendingLinkFinals ?? '[]').includes(id),
            id
          )
        )
        .toBe(true);
    const release = (id: number, mode: 'progress' | 'all' | 'replay' = 'all') =>
      page.evaluate(
        (detail) => document.dispatchEvent(new CustomEvent('release-project-canvas', { detail })),
        { id, mode }
      );
    const latestRequest = () =>
      page.evaluate(() => Number(document.documentElement.dataset.lastLinkRequest));
    await waitForResult(1);
    const count = await page.locator('.cc-item').count();
    expect(count).toBeGreaterThan(0);
    await browserExpect(page.locator('.cc-world')).toHaveCSS('visibility', 'visible');
    await browserExpect(viewport).toHaveAttribute('aria-busy', 'true');
    await browserExpect(page.locator('.cc-line')).toHaveCount(0);
    await release(1, 'progress');
    await browserExpect(page.locator('.cc-line')).toHaveCount(1);
    await browserExpect(viewport).toHaveAttribute('aria-busy', 'true');
    const firstLink = await page.locator('.cc-line').elementHandle();
    if (!firstLink) throw new Error('Expected the first progressive item dependency link');
    const firstPath = await firstLink.getAttribute('d');
    const firstObservation = await observeAttributes(firstLink);
    await release(1);
    await browserExpect(viewport).toHaveAttribute('aria-busy', 'false');
    expect(await page.locator('.cc-line').count()).toBeGreaterThan(1);
    expect(await firstLink.evaluate((link) => link.isConnected)).toBe(true);
    expect(await firstLink.getAttribute('d')).toBe(firstPath);
    expect(await firstObservation.evaluate(({ mutations }) => mutations)).toEqual([]);
    await firstObservation.evaluate(({ observer }) => observer.disconnect());
    await firstObservation.dispose();
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
    const collapsedRequest = await latestRequest();
    await waitForResult(collapsedRequest);
    await browserExpect(viewport).toHaveAttribute('aria-busy', 'true');
    await browserExpect(page.locator('.cc-item')).toHaveCount(0);
    await browserExpect(page.locator('.cc-world')).toHaveCSS('visibility', 'visible');
    await page.getByRole('button', { name: 'Expand all sections', exact: true }).click();
    await browserExpect(page.locator('.cc-item')).toHaveCount(count);
    await page.getByRole('button', { name: 'Collapse all sections', exact: true }).click();
    await browserExpect(page.locator('.cc-item')).toHaveCount(0);
    const collapsedStyle = await page.locator('.cc-world').getAttribute('style');
    const collapsedLinks = await page
      .locator('.cc-line')
      .evaluateAll((paths) =>
        paths.map((path) => ({ key: path.getAttribute('data-edge'), d: path.getAttribute('d') }))
      );
    await release(collapsedRequest, 'progress');
    expect(
      await page
        .locator('.cc-line')
        .evaluateAll((paths) =>
          paths.map((path) => ({ key: path.getAttribute('data-edge'), d: path.getAttribute('d') }))
        )
    ).toEqual(collapsedLinks);
    await release(collapsedRequest);
    await browserExpect.poll(latestRequest).toBeGreaterThan(collapsedRequest);
    const currentCollapsedRequest = await latestRequest();
    await waitForResult(currentCollapsedRequest);
    await release(collapsedRequest, 'replay');
    // Obsolete progress and final results cannot replace the current collapsed geometry or links.
    await browserExpect(viewport).toHaveAttribute('aria-busy', 'true');
    await browserExpect(page.locator('.cc-item')).toHaveCount(0);
    expect(await page.locator('.cc-world').getAttribute('style')).toBe(collapsedStyle);
    expect(
      await page
        .locator('.cc-line')
        .evaluateAll((paths) =>
          paths.map((path) => ({ key: path.getAttribute('data-edge'), d: path.getAttribute('d') }))
        )
    ).toEqual(collapsedLinks);
    await release(currentCollapsedRequest);
    await browserExpect(viewport).toHaveAttribute('aria-busy', 'false');
    await browserExpect(page.locator('.cc-item')).toHaveCount(0);
    await page.getByRole('button', { name: 'Expand all sections', exact: true }).click();
    await browserExpect(page.locator('.cc-item')).toHaveCount(count);
    const expandedRequest = await latestRequest();
    await waitForResult(expandedRequest);
    await release(expandedRequest);
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
    const survivingLink = await page
      .locator(`.cc-line[data-edge="${surviving.key}"]`)
      .elementHandle();
    if (!survivingLink) throw new Error('Expected a retained SVG path');
    await removedItem.click();
    await browserExpect(page.getByRole('toolbar', { name: 'Selected item actions' })).toBeVisible();
    const observation = await observeAttributes(survivingLink);
    const retainedItems = { ...served.entities.items };
    delete retainedItems['item:1002'];
    served = { ...served, entities: { ...served.entities, items: retainedItems } };
    await browserExpect(removedItem).toHaveCount(0);
    const removedRequest = await latestRequest();
    await waitForResult(removedRequest);
    await browserExpect(incident).toHaveCount(0);
    await browserExpect(page.locator(`.cc-line[data-edge="${surviving.key}"]`)).toHaveAttribute(
      'd',
      surviving.d
    );
    expect(await survivingLink.evaluate((link) => link.isConnected)).toBe(true);
    expect(await observation.evaluate(({ mutations }) => mutations)).toEqual([]);
    await browserExpect(page.getByRole('toolbar', { name: 'Selected item actions' })).toHaveCount(
      0
    );
    await observation.evaluate(({ observer }) => observer.disconnect());
    await observation.dispose();
    await release(removedRequest);
    await browserExpect(viewport).toHaveAttribute('aria-busy', 'false');
    await browserExpect(page.locator('.cc-item')).toHaveCount(count - 1);
    expect(await survivingLink.evaluate((link) => link.isConnected)).toBe(true);
    // Its final lane can change when the deleted item's reserved terminal disappears.
    // The SVG identity still survives that valid route update.
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
    await vite.close();
  }
}, 30000);
