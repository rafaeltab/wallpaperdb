import { mkdir } from 'node:fs/promises';
import { chromium, expect as browserExpect } from '@playwright/test';
import { createServer } from 'vite';
import { expect, it } from 'vitest';
import {
  fakeV2Server,
  type FactoryV2Snapshot,
  type FactoryV2Command,
} from '../../src/http/index.js';

it.each([1280, 480])(
  'manually retries a stopped issue through its quick actions at %ipx',
  async (width) => {
    const fake = fakeV2Server({ epoch: `retry-browser-${width}` });
    const seed = (await fake.inject('/api/v2/board')).json<FactoryV2Snapshot>();
    await fake.close();
    const item = seed.entities.items['item:1002'];
    const job = seed.entities.jobs['job:1002'];
    const actionId = 'action:retry-failed' as const;
    let value: FactoryV2Snapshot = {
      ...seed,
      meta: {
        ...seed.meta,
        factory: {
          ...seed.meta.factory,
          paused: false,
          concurrency: { limit: { kind: 'limited', maximum: 1 }, occupied: 0 },
          admission: { limit: { kind: 'limited', maximum: 1 }, consumed: 1 },
        },
      },
      entities: {
        ...seed.entities,
        relationships: {},
        stacks: {},
        items: {
          [item.id]: {
            ...item,
            actionIds: [actionId],
            status: {
              code: 'manual-recovery',
              label: 'manual recovery',
              active: false,
              since: null,
            },
            attention: {
              state: 'required',
              sourceIds: ['source:factory'],
              reasons: [
                {
                  code: 'manual-recovery',
                  message: 'Implementation finished without a validated success receipt.',
                  actionIds: [actionId],
                },
              ],
            },
          },
        },
        jobs: {
          [job.id]: {
            ...job,
            activity: 'manual-recovery',
            occupiesCapacity: false,
            progress: 'Implementation finished without a validated success receipt.',
            execution: {
              state: 'known',
              value: { runId: 'failed-run-1', state: 'finished' },
              sourceId: 'source:factory',
              observedAt: seed.committedAt,
            },
          },
        },
        actions: {
          ...seed.entities.actions,
          [actionId]: {
            id: actionId,
            version: 'retry-v1',
            kind: 'retry',
            targetId: job.id,
            availability: {
              state: 'available',
              precondition: 'failed-attempt-v1',
              validUntil: null,
            },
          },
        },
      },
    };
    const vite = await createServer({ configFile: 'frontend/vite.config.ts', server: { port: 0 } });
    const browser = await chromium.launch({ headless: true });
    const directory = width === 1280 ? process.env.FACTORY_DEMO_DIRECTORY : undefined;
    if (directory) await mkdir(directory, { recursive: true });
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      recordVideo: directory ? { dir: directory, size: { width, height: 900 } } : undefined,
    });
    const page = await context.newPage();
    const posts: FactoryV2Command[] = [];
    const errors: string[] = [];
    let accepted: FactoryV2Command | undefined,
      observations = 0;
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/api/**', async (route) => {
      const request = route.request(),
        path = new URL(request.url()).pathname;
      if (request.method() === 'GET' && path === '/api/v2/board')
        return route.fulfill({ json: value });
      if (request.method() === 'POST') {
        const command: FactoryV2Command = request.postDataJSON();
        expect(command.kind).toBe('retry');
        expect(command.actionId).toBe(actionId);
        expect(command.payload).toEqual({});
        posts.push(command);
        expect(posts).toHaveLength(1);
        expect(command.precondition).toBe('failed-attempt-v1');
        accepted = command;
        return route.fulfill({
          status: 202,
          json: {
            commandId: command.commandId,
            version: '1',
            actionId,
            state: 'accepted',
            acceptedAt: seed.committedAt,
            completedAt: null,
            reasons: [],
            result: null,
            resultingCursor: null,
          },
        });
      }
      if (
        request.method() === 'GET' &&
        accepted &&
        path === `/api/v2/commands/${accepted.commandId}`
      ) {
        observations++;
        if (observations > 1) {
          const threadId = 'thread:controlled-environment/retry-worker' as const;
          const oldThread = job.threadId
            ? seed.entities.threads[job.threadId]
            : Object.values(seed.entities.threads)[0];
          if (oldThread.metadata.state !== 'known')
            throw new Error('Missing controlled thread metadata');
          value = {
            ...value,
            cursor: `${value.cursor}-running`,
            meta: {
              ...value.meta,
              factory: {
                ...value.meta.factory,
                concurrency: { ...value.meta.factory.concurrency, occupied: 1 },
              },
            },
            entities: {
              ...value.entities,
              threads: {
                ...value.entities.threads,
                [threadId]: {
                  ...oldThread,
                  id: threadId,
                  version: 'fresh-thread',
                  metadata: {
                    ...oldThread.metadata,
                    value: {
                      ...oldThread.metadata.value,
                      title: 'Fresh implementation attempt',
                      threadId: 'retry-worker',
                      environmentId: 'controlled-environment',
                      status: 'running',
                      webUrl: 'https://app.t3.codes/controlled-environment/retry-worker',
                      nativeUrl: 't3code://threads/controlled-environment/retry-worker',
                    },
                  },
                },
              },
              jobs: {
                [job.id]: {
                  ...job,
                  version: 'fresh-job',
                  threadId,
                  activity: 'implementation',
                  occupiesCapacity: true,
                  progress: 'Fresh original-base implementation attempt.',
                  execution: {
                    state: 'known',
                    value: { state: 'running', runId: 'fresh-run-1' },
                    sourceId: 'source:factory',
                    observedAt: seed.committedAt,
                  },
                },
              },
              items: {
                [item.id]: {
                  ...item,
                  version: 'fresh-item',
                  actionIds: [actionId],
                  threadIds: [threadId],
                  status: {
                    code: 'implementing',
                    label: 'implementing',
                    active: true,
                    since: null,
                  },
                  attention: { state: 'none', sourceIds: ['source:factory'] },
                },
              },
              actions: {
                ...value.entities.actions,
                [actionId]: {
                  ...value.entities.actions[actionId],
                  version: 'retry-disabled',
                  availability: {
                    state: 'disabled',
                    reasons: [
                      { code: 'unavailable', message: 'The fresh implementation is running.' },
                    ],
                  },
                },
              },
            },
          };
        }
        return route.fulfill({
          json: {
            commandId: accepted.commandId,
            version: String(observations + 1),
            actionId,
            state: observations > 1 ? 'succeeded' : 'running',
            acceptedAt: seed.committedAt,
            completedAt: observations > 1 ? seed.committedAt : null,
            reasons: [],
            result: observations > 1 ? { jobId: job.id } : null,
            resultingCursor: null,
          },
        });
      }
      return route.abort();
    });
    try {
      await vite.listen();
      const origin = vite.resolvedUrls?.local[0];
      if (!origin) throw new Error('Missing controlled browser origin');
      await page.goto(origin);
      await page.getByRole('group', { name: 'Select Implement the command centre' }).click();
      const retry = page.getByRole('button', { name: 'Retry', exact: true });
      await browserExpect(retry).toHaveText('Retry');
      await browserExpect(retry).toBeInViewport();
      await browserExpect(retry).toHaveAttribute(
        'title',
        /fresh context and a clean checkout at the original base/
      );
      if (directory) await page.screenshot({ path: `${directory}/implementation-stopped.png` });
      await retry.click();
      await browserExpect(retry).toBeDisabled();
      await browserExpect(
        page
          .getByRole('group', { name: 'Select Implement the command centre' })
          .getByText('implementing', { exact: true })
      ).toBeVisible();
      await browserExpect(
        page.locator('a[href="https://app.t3.codes/controlled-environment/retry-worker"]').first()
      ).toHaveAttribute('href', 'https://app.t3.codes/controlled-environment/retry-worker');
      expect(value.meta.factory.admission.consumed).toBe(1);
      expect(posts).toHaveLength(1);
      expect(errors).toEqual([]);
      if (directory) await page.screenshot({ path: `${directory}/implementation-retried.png` });
    } finally {
      await context.close();
      await browser.close();
      await vite.close();
    }
  }
);
