import { mkdir } from 'node:fs/promises';
import { chromium, expect as browserExpect } from '@playwright/test';
import { createServer } from 'vite';
import { expect, it } from 'vitest';
import { fakeV2Server, type FactoryV2Snapshot } from '../../src/http/index.js';

it('shows planning exhaustion on open, reports acknowledgement failure and keeps explicit resume separate', async () => {
  const fake = fakeV2Server({ epoch: 'planning-browser' });
  const seed = (await fake.inject('/api/v2/board')).json<FactoryV2Snapshot>();
  await fake.close();
  const id = `action:acknowledge-planning-failures/${seed.meta.factory.id}` as const;
  const thread = Object.values(seed.entities.threads)[0];
  const failures = [0, 1, 2].map((index) => ({
    attemptId: `automatic-attempt-${index + 1}`,
    code: 'model-deadline' as const,
    message: `Automatic planning attempt ${index + 1} exceeded its model deadline.`,
    attemptStartedAt: `2026-11-08T12:${String(index * 15).padStart(2, '0')}:00.000Z`,
    modelHandedOffAt: `2026-11-08T12:${String(index * 15 + 3).padStart(2, '0')}:00.000Z`,
    deadline: `2026-11-08T12:${String(index * 15 + 13).padStart(2, '0')}:00.000Z`,
    failedAt: `2026-11-08T12:${String(index * 15 + 14).padStart(2, '0')}:00.000Z`,
    attemptElapsedMs: 840000,
    modelElapsedMs: 660000,
    threadId: thread?.id ?? null,
    runId: `exact-run-${index + 1}`,
  }));
  let value: FactoryV2Snapshot = {
    ...seed,
    meta: {
      ...seed.meta,
      factory: {
        ...seed.meta.factory,
        paused: true,
        actionIds: [...seed.meta.factory.actionIds, id],
        planning: {
          maximumAttempts: 3,
          consecutiveModelDeadlineFailures: 3,
          pendingNoticeCount: 1,
          notice: {
            id: 'planning-notice:exhausted',
            version: 'unseen',
            createdAt: failures[0].failedAt,
            acknowledgedAt: null,
            failures,
          },
        },
      },
    },
    entities: {
      ...seed.entities,
      actions: {
        ...seed.entities.actions,
        [id]: {
          id,
          version: 'ack-v1',
          kind: 'acknowledge-planning-failures',
          targetId: seed.meta.factory.id,
          availability: { state: 'available', precondition: 'exhausted-v1', validUntil: null },
        },
      },
    },
  };
  const vite = await createServer({ configFile: 'frontend/vite.config.ts', server: { port: 0 } });
  const browser = await chromium.launch({ headless: true });
  const directory = process.env.FACTORY_DEMO_DIRECTORY;
  if (directory) await mkdir(directory, { recursive: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    recordVideo: directory ? { dir: directory, size: { width: 1280, height: 900 } } : undefined,
  });
  const page = await context.newPage();
  let rejected = false,
    acknowledged = false,
    resumed = false;
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    if (request.method() === 'GET' && new URL(request.url()).pathname === '/api/v2/board')
      return route.fulfill({ json: value });
    if (request.method() !== 'POST') return route.abort();
    const command = request.postDataJSON();
    if (command.kind === 'acknowledge-planning-failures') {
      expect(command.precondition).toBe('exhausted-v1');
      if (!rejected) {
        rejected = true;
        return route.fulfill({
          status: 412,
          json: {
            detail: 'Planning notice changed. Refresh before acknowledging.',
            retry: 'refresh',
          },
        });
      }
      acknowledged = true;
      const notice = value.meta.factory.planning.notice!;
      value = {
        ...value,
        meta: {
          ...value.meta,
          factory: {
            ...value.meta.factory,
            planning: {
              ...value.meta.factory.planning,
              pendingNoticeCount: 0,
              notice: { ...notice, version: 'seen', acknowledgedAt: '2026-11-08T13:00:00.000Z' },
            },
          },
        },
      };
    } else if (command.kind === 'configure') {
      expect(acknowledged).toBe(true);
      expect(command.payload.paused).toBe(false);
      resumed = true;
      value = {
        ...value,
        meta: {
          ...value.meta,
          factory: {
            ...value.meta.factory,
            paused: false,
            planning: { ...value.meta.factory.planning, consecutiveModelDeadlineFailures: 0 },
          },
        },
      };
    } else throw new Error('No other fixture commands authorized');
    return route.fulfill({
      json: {
        commandId: command.commandId,
        version: 'complete',
        actionId: command.actionId,
        state: 'succeeded',
        acceptedAt: '2026-11-08T13:00:00.000Z',
        completedAt: '2026-11-08T13:00:00.000Z',
        reasons: [],
        result: null,
        resultingCursor: null,
      },
    });
  });
  try {
    await vite.listen();
    const origin = vite.resolvedUrls?.local[0];
    if (!origin) throw new Error('No Vite origin');
    await page.goto(origin);
    await browserExpect(
      page.getByRole('heading', { name: 'Planning needs attention' })
    ).toBeVisible();
    await browserExpect(page.getByText(/factory paused after three/)).toBeVisible();
    await browserExpect(page.getByRole('button', { name: /Resume/ })).toBeDisabled();
    expect(acknowledged).toBe(false);
    if (thread?.metadata.state === 'known')
      await browserExpect(
        page.getByRole('link', { name: 'Planner in T3' }).first()
      ).toHaveAttribute('href', thread.metadata.value.webUrl ?? thread.metadata.value.nativeUrl!);
    if (directory) await page.screenshot({ path: `${directory}/planning-unseen.png` });
    await page.getByRole('button', { name: 'Acknowledge seen' }).click();
    await browserExpect(page.getByRole('alert')).toContainText('Planning notice changed');
    await browserExpect(page.getByRole('button', { name: /Resume/ })).toBeDisabled();
    await page.getByRole('button', { name: 'Acknowledge seen' }).click();
    await browserExpect(
      page.getByRole('heading', { name: 'Seen planning failures' })
    ).toBeVisible();
    await browserExpect(page.getByText('Paused', { exact: true })).toBeVisible();
    expect(resumed).toBe(false);
    await browserExpect(page.getByRole('button', { name: 'Acknowledged' })).toBeFocused();
    await page.getByText('Inspect seen failure details').click();
    await browserExpect(page.getByText(/Model elapsed: 660.0 seconds/).first()).toBeVisible();
    await page.getByText('Inspect seen failure details').click();
    await page.getByRole('button', { name: /Resume/ }).click();
    await browserExpect(page.getByText('Running', { exact: true })).toBeVisible();
    expect(resumed).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
    await browser.close();
    await vite.close();
  }
});
