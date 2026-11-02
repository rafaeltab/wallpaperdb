import { chromium, expect as browserExpect } from '@playwright/test';
import { Effect } from 'effect';
import { expect, it } from 'vitest';
import { operationsServer } from '../src/http/index.js';
import type { Preview } from '../src/capabilities/plan/index.js';
import type { Job, Status } from '../src/capabilities/job/index.js';

it('shows directed current dependencies and safe explicit and proposed plan context without dispatching', async () => {
  const current: Status = {
    kind: 'job',
    intent: {
      id: 'work-2',
      issue: 2,
      issueUrl: 'https://github.com/rafaeltab/wallpaperdb/issues/2',
      base: 'a'.repeat(40),
      context: '',
      branch: 'job-2',
      createdAt: 0,
      expectedStage: 'implementation',
    },
    execution: { kind: 'absent' },
    elapsedMs: 0,
  };
  let starts = 0;
  const job: Job = {
    status: () => Effect.succeed(current),
    start: () =>
      Effect.sync(() => {
        starts++;
        return current;
      }),
    resume: () => Effect.succeed({ kind: 'rejected' }),
    cancel: () => Effect.succeed({ kind: 'rejected' }),
  };
  let stale = false;
  const preview = (): Preview => ({
    kind: stale ? 'stale' : 'preview',
    selected: [
      { issue: 3, reason: '<img src=x onerror="alert(1)">', dependsOn: [2], conflicts: [4] },
    ],
    rejected: [],
    input: {
      job: current,
      capacity: { concurrency: 1, admission: 1 },
      issues: [
        {
          number: 3,
          url: 'https://github.com/rafaeltab/wallpaperdb/issues/3',
          title: '<unsafe title>',
          body: '',
          author: 'rafaeltab',
          open: true,
          labels: ['ready-for-agent'],
          comments: [],
          blockers: [1],
          parents: [571],
          blockersReady: true,
          prerequisiteEvidence: '',
        },
      ],
    },
  });
  const state = {
    revision: 0,
    concurrency: 1,
    allowance: 1,
    paused: true,
    admissions: [
      { issue: 2, base: 'a'.repeat(40), context: '' },
      { issue: 3, base: 'a'.repeat(40), context: '' },
    ],
  };
  const app = operationsServer({
    base: 'a'.repeat(40),
    job,
    run: Effect.runPromise,
    relationships: () =>
      Effect.succeed([
        { issue: 2, blockers: [1] },
        { issue: 3, blockers: [2] },
      ]),
    scheduler: {
      status: () => Effect.succeed({ state, jobs: [current] }),
      tick: () => Effect.succeed({ state, jobs: [current] }),
      configure: () => Effect.succeed('saved'),
      start: job.start,
      resume: job.resume,
      cancel: job.cancel,
    },
    plan: { preview: () => Effect.succeed(preview()) },
  });
  const browser = await chromium.launch({ headless: true });
  try {
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address();
    if (!address || typeof address === 'string') throw new Error('Missing listener');
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${address.port}`);
    await browserExpect(
      page.getByText('Issue #2 prerequisites: #1; admitted dependents: #3', { exact: false })
    ).toBeVisible();
    await browserExpect(
      page.getByText('Issue #3 prerequisites: #2; admitted dependents: None', { exact: false })
    ).toBeVisible();
    await page.getByRole('button', { name: 'Generate plan preview' }).click();
    const plan = page.locator('#plan');
    await browserExpect(plan).toContainText('Explicit prerequisites: #1');
    await browserExpect(plan).toContainText('Parent specs: #571');
    await browserExpect(plan).toContainText('Proposed dependencies: #2');
    await browserExpect(plan).toContainText('Proposed conflicts: #4');
    await browserExpect(plan.getByRole('link', { name: '#571', exact: true })).toHaveAttribute(
      'href',
      'https://github.com/rafaeltab/wallpaperdb/issues/571'
    );
    await browserExpect(plan).toContainText('<unsafe title>');
    await browserExpect(plan.locator('img')).toHaveCount(0);
    stale = true;
    await page.getByRole('button', { name: 'Generate plan preview' }).click();
    await browserExpect(plan).toContainText('Stale proposal. Generate a fresh preview.');
    await browserExpect(plan).not.toContainText('Validated advisory proposal');
    expect(starts).toBe(0);
    expect((await app.inject('/api/scheduler')).json()).toMatchObject({
      relationships: [
        { issue: 2, blockers: [1] },
        { issue: 3, blockers: [2] },
      ],
    });
  } finally {
    await browser.close();
    await app.close();
  }
});
