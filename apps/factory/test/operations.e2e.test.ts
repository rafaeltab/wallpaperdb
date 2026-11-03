import { Effect } from 'effect';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, expect as browserExpect } from '@playwright/test';
import { expect, it } from 'vitest';
import { startFactory } from '../src/composition/index.js';
import { protocol } from './fixtures/setup.js';
it('starts one deliberately selected job and observes stage, elapsed time and work links', async () => {
  const host = await protocol();
  const path = process.env.PATH;
  const fixture = process.env.FACTORY_FIXTURE;
  process.env.PATH = host.directory + ':' + path;
  process.env.FACTORY_FIXTURE = host.configFile;
  const browser = await chromium.launch({ headless: true });
  try {
    const running = await startFactory({
      FACTORY_PROJECT: host.repository,
      FACTORY_T3_PROJECT_ID: 'project-id',
      FACTORY_BASE: host.base,
      FACTORY_T3_BINARY: host.binary,
      FACTORY_STATE: host.directory + '/state',
      FACTORY_PORT: '0',
    });
    try {
      const page = await browser.newPage();
      const address = running.app.server.address();
      if (!address || typeof address === 'string') throw new Error('Missing listener');
      await page.goto(`http://127.0.0.1:${address.port}`);
      await page.getByLabel('Selected issue number').fill('576');
      await page.getByLabel('Maintainer execution context').fill('Inspect only. No writes.');
      await page.getByRole('button', { name: 'Start selected issue' }).click();
      await browserExpect(
        page.getByRole('heading', { name: 'Implementation', exact: true })
      ).toBeVisible();
      await browserExpect(page.getByText('Status: running')).toBeVisible();
      await browserExpect(page.getByRole('link', { name: 'Issue #576' })).toHaveAttribute(
        'href',
        'https://github.com/rafaeltab/wallpaperdb/issues/576'
      );
      await browserExpect(page.getByRole('link', { name: 'Open T3 thread' })).toHaveAttribute(
        'href',
        't3-thread://v1/thread-live'
      );
      await browserExpect(page.getByText(/Elapsed: \d+ seconds/)).toBeVisible();
      await page.getByRole('link', { name: 'Refresh observation' }).click();
      await browserExpect(page.getByText('Status: running')).toBeVisible();
      await host.save({ complete: true, base: host.base, overrides: { status: 'completed' } });
      await browserExpect
        .poll(async () => {
          await page.reload();
          return page.getByText('Ready for manual merge', { exact: true }).count();
        })
        .toBe(1);
      await browserExpect(page.getByText('Not landed.', { exact: false })).toBeVisible();
      await browserExpect(page.getByRole('link', { name: 'Open pull request' })).toHaveAttribute(
        'href',
        'https://github.com/rafaeltab/wallpaperdb/pull/999'
      );
      await browserExpect(page.getByText(host.base, { exact: true })).toBeVisible();
      const pr = JSON.parse(await readFile(join(host.directory, 'pr.json'), 'utf8'));
      await host.save({
        complete: true,
        base: host.base,
        overrides: { status: 'completed' },
        prs: [{ ...pr, state: 'MERGED' }],
        landing: { pr: 999, merge: host.base, head: host.base },
      });
      await browserExpect
        .poll(async () => {
          await page.reload();
          return page.getByText('Landed on the default branch', { exact: true }).count();
        })
        .toBe(1);
      await browserExpect(
        page.getByText('Linked issue closed; project Done', { exact: false })
      ).toBeVisible();
      pr.statusCheckRollup[0].conclusion = 'FAILURE';
      await host.save({
        complete: true,
        base: host.base,
        prs: [pr],
        waitingForGithub: true,
        overrides: { status: 'completed' },
      });
      await browserExpect
        .poll(async () => {
          await page.reload();
          return page.getByText('waiting-for-github', { exact: true }).count();
        })
        .toBe(1);
      await browserExpect(
        page.getByRole('heading', { name: 'Babysitting', exact: true })
      ).toBeVisible();
      await browserExpect(page.getByText(/GitHub wait deadline:/)).toBeVisible();
      await browserExpect(page.getByText('Ready for manual merge', { exact: true })).toHaveCount(0);
      expect(
        (await host.calls()).filter(
          (call) => call.binary === 't3' && call.args[1] === 'send' && !call.args.includes('--help')
        )
      ).toHaveLength(3);
      expect(
        (await host.calls()).filter(
          (call) =>
            call.binary === 't3' && call.args[1] === 'start' && !call.args.includes('--help')
        )
      ).toHaveLength(1);
    } finally {
      await running.close();
    }
  } finally {
    await browser.close();
    process.env.PATH = path;
    if (fixture === undefined) delete process.env.FACTORY_FIXTURE;
    else process.env.FACTORY_FIXTURE = fixture;
    await host.cleanup();
  }
});
it('parks a question visibly, resumes its existing worker once, and cancels explicitly', async () => {
  const host = await protocol();
  const previous = { path: process.env.PATH, fixture: process.env.FACTORY_FIXTURE };
  process.env.PATH = `${host.directory}:${previous.path}`;
  process.env.FACTORY_FIXTURE = host.configFile;
  const { writeFile } = await import('node:fs/promises');
  const authorization = `${host.directory}/authorization`;
  await writeFile(authorization, 'Bearer controlled-protocol');
  const browser = await chromium.launch({ headless: true });
  try {
    const running = await startFactory({
      FACTORY_PROJECT: host.repository,
      FACTORY_T3_PROJECT_ID: 'project-id',
      FACTORY_BASE: host.base,
      FACTORY_T3_BINARY: host.binary,
      FACTORY_STATE: `${host.directory}/state`,
      FACTORY_PORT: '0',
      FACTORY_T3_MCP_ENDPOINT: 'http://127.0.0.1:1/mcp',
      FACTORY_T3_MCP_AUTHORIZATION_FILE: authorization,
    });
    try {
      const page = await browser.newPage();
      const address = running.app.server.address();
      if (!address || typeof address === 'string') throw new Error('Missing listener');
      await page.goto(`http://127.0.0.1:${address.port}`);
      await page.getByLabel('Selected issue number').fill('579');
      await page.getByRole('button', { name: 'Start selected issue' }).click();
      await browserExpect(page.getByText('Status: running')).toBeVisible();
      const before = await (
        await page.request.get(`http://127.0.0.1:${address.port}/api/job`)
      ).json();
      await host.save({
        activity: [
          {
            itemId: 'q-579',
            runId: 'run-1',
            sourceThreadId: 'thread-live',
            visibility: 'local',
            type: 'user_input_request',
            status: 'waiting',
            text: 'Which approved option?',
          },
        ],
        overrides: { pendingRequestCount: 1, status: 'waiting' },
      });
      await page.reload();
      await browserExpect(page.getByText('Which approved option?', { exact: true })).toBeVisible();
      await browserExpect(page.getByText(/Active capacity released/)).toBeVisible();
      await browserExpect(page.getByRole('button', { name: 'Resume existing job' })).toBeDisabled();
      await browserExpect(page.getByRole('link', { name: 'Open T3 thread' })).toHaveAttribute(
        'href',
        't3-thread://v1/thread-live'
      );
      await host.save({ activity: [], overrides: { pendingRequestCount: 0, status: 'completed' } });
      await page.reload();
      await page.getByRole('button', { name: 'Resume existing job' }).click();
      await browserExpect(page.getByRole('button', { name: 'Resume existing job' })).toHaveCount(0);
      const resumed = await (
        await page.request.get(`http://127.0.0.1:${address.port}/api/job`)
      ).json();
      expect(resumed.intent).toEqual(before.intent);
      expect(resumed.delivery).toMatchObject({ stage: 'implementation', ready: false });
      await page.getByRole('button', { name: 'Cancel job' }).click();
      await browserExpect(page.getByText('cancelled', { exact: true })).toBeVisible();
      expect(
        (await host.calls()).filter(
          (call) => call.args[1] === 'start' && !call.args.includes('--help')
        )
      ).toHaveLength(1);
      expect(
        (await host.calls()).filter(
          (call) => call.args[0] === 'acp-mcp-call' && call.args[1] === 't3_thread_send'
        )
      ).toHaveLength(1);
    } finally {
      await running.close();
    }
  } finally {
    await browser.close();
    process.env.PATH = previous.path;
    if (previous.fixture === undefined) delete process.env.FACTORY_FIXTURE;
    else process.env.FACTORY_FIXTURE = previous.fixture;
    await host.cleanup();
  }
});

it('previews automatically discovered work without starting an implementation worker', async () => {
  const host = await protocol();
  const previous = { path: process.env.PATH, fixture: process.env.FACTORY_FIXTURE };
  process.env.PATH = `${host.directory}:${previous.path}`;
  process.env.FACTORY_FIXTURE = host.configFile;
  const issue = {
    number: 580,
    title: 'Plan preview',
    body: 'Preview only',
    state: 'OPEN',
    url: 'https://github.com/rafaeltab/wallpaperdb/issues/580',
    author: { login: 'rafaeltab' },
    labels: [{ name: 'ready-for-agent' }],
    comments: [],
  };
  await host.save({
    planning: {
      issues: [
        issue,
        {
          ...issue,
          number: 579,
          url: 'https://github.com/rafaeltab/wallpaperdb/issues/579',
          labels: [{ name: 'future-work' }],
        },
      ],
    },
    planner: {
      proposal: {
        selected: [
          { issue: 580, reason: 'Thin end-to-end experiment', dependsOn: [], conflicts: [] },
          { issue: 579, reason: 'Try deferred work', dependsOn: [], conflicts: [] },
        ],
        deferred: [],
      },
    },
  });
  const browser = await chromium.launch({ headless: true });
  try {
    const running = await startFactory({
      FACTORY_PROJECT: host.repository,
      FACTORY_T3_PROJECT_ID: 'project-id',
      FACTORY_BASE: host.base,
      FACTORY_T3_BINARY: host.binary,
      FACTORY_STATE: `${host.directory}/state`,
      FACTORY_PORT: '0',
    });
    try {
      const page = await browser.newPage();
      const address = running.app.server.address();
      if (!address || typeof address === 'string') throw new Error('Missing listener');
      await page.goto(`http://127.0.0.1:${address.port}`);
      await page.getByLabel('Pause admissions').check();
      const savedDocument = page.waitForEvent('load');
      await page.getByRole('button', { name: 'Save scheduler controls' }).click();
      await savedDocument;
      await browserExpect(page.getByLabel('Pause admissions')).toBeChecked();
      await page.getByRole('button', { name: 'Generate plan preview' }).click();
      await browserExpect(page.locator('#plan')).toContainText('Validated advisory proposal');
      await browserExpect(page.locator('#plan')).toContainText('#580: Thin end-to-end experiment');
      await browserExpect(page.locator('#plan')).toContainText('Not ready for agent');
      await browserExpect(page.locator('#plan')).toContainText('No work was dispatched.');
      expect((await running.app.inject('/api/job')).json()).toEqual({ kind: 'empty' });
      const launches = (await host.calls()).filter(
        (c) => c.args[1] === 'start' && !c.args.includes('--help')
      );
      expect(launches).toHaveLength(1);
      expect(launches[0].args).not.toContain('--worktree');
    } finally {
      await running.close();
    }
  } finally {
    await browser.close();
    process.env.PATH = previous.path;
    if (previous.fixture === undefined) delete process.env.FACTORY_FIXTURE;
    else process.env.FACTORY_FIXTURE = previous.fixture;
    await host.cleanup();
  }
});

it('edits durable scheduler limits and pauses admissions while an existing job continues', async () => {
  const host = await protocol();
  const previous = { path: process.env.PATH, fixture: process.env.FACTORY_FIXTURE };
  process.env.PATH = `${host.directory}:${previous.path}`;
  process.env.FACTORY_FIXTURE = host.configFile;
  const { mkdtemp } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const recording = await mkdtemp(join(tmpdir(), 'factory-581-demo-'));
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 960, height: 900 },
    recordVideo: { dir: recording, size: { width: 960, height: 900 } },
  });
  try {
    const running = await startFactory({
      FACTORY_PROJECT: host.repository,
      FACTORY_T3_PROJECT_ID: 'project-id',
      FACTORY_BASE: host.base,
      FACTORY_T3_BINARY: host.binary,
      FACTORY_STATE: `${host.directory}/state`,
      FACTORY_PORT: '0',
    });
    try {
      const page = await context.newPage();
      const address = running.app.server.address();
      if (!address || typeof address === 'string') throw new Error('Missing listener');
      await page.goto(`http://127.0.0.1:${address.port}`);
      await browserExpect(page.getByLabel('Concurrency')).toHaveValue('1');
      await browserExpect(page.getByLabel('Distinct issue allowance')).toHaveValue('1');
      await page.getByLabel('Selected issue number').fill('581');
      await page.getByRole('button', { name: 'Start selected issue' }).click();
      await browserExpect(page.getByText('Status: running')).toBeVisible();
      await page.getByLabel('Concurrency').fill('3');
      await page.getByLabel('Distinct issue allowance').fill('-1');
      await page.getByLabel('Pause admissions').check();
      await page.getByRole('button', { name: 'Save scheduler controls' }).click();
      await browserExpect(page.getByText('Admissions: 1. Admissions paused.')).toBeVisible();
      await browserExpect(page.getByText('Status: running')).toBeVisible();
      await page.reload();
      await browserExpect(page.getByLabel('Concurrency')).toHaveValue('3');
      await browserExpect(page.getByLabel('Pause admissions')).toBeChecked();
      await browserExpect(page.getByRole('link', { name: 'Open T3 thread' })).toHaveAttribute(
        'href',
        't3-thread://v1/thread-live'
      );
      await page.getByLabel('Concurrency').fill('-1');
      await page.getByLabel('Pause admissions').uncheck();
      await page.getByRole('button', { name: 'Save scheduler controls' }).click();
      await browserExpect(page.getByText('Admissions: 1. Admissions enabled.')).toBeVisible();
      await browserExpect(page.getByLabel('Concurrency')).toHaveValue('-1');
      await browserExpect(page.getByText('Status: running')).toBeVisible();
      const launches = (await host.calls()).filter(
        (c) => c.args[1] === 'start' && c.args.includes('--worktree')
      );
      expect(launches).toHaveLength(1);
    } finally {
      await running.close();
    }
  } finally {
    await context.close();
    await browser.close();
    process.env.PATH = previous.path;
    if (previous.fixture === undefined) delete process.env.FACTORY_FIXTURE;
    else process.env.FACTORY_FIXTURE = previous.fixture;
    await host.cleanup();
    process.stdout.write(`Controlled GitHub/T3 protocol scheduler demo recording: ${recording}\n`);
  }
});

it('shows conflict classification and pending questions with a recovery-thread link', async () => {
  const { joinFixture } = await import('./fixtures/join.js');
  const f = await joinFixture({ conflict: true, restack: { outcome: 'COMPLEX', review: false } });
  const browser = await chromium.launch({ headless: true });
  let running: Awaited<ReturnType<typeof startFactory>> | undefined;
  try {
    await Effect.runPromise(f.issues.prepare?.(5) ?? Effect.void);
    await Effect.runPromise(f.issues.prepare?.(5) ?? Effect.void);
    running = await startFactory({
      FACTORY_PROJECT: f.host.repository,
      FACTORY_T3_PROJECT_ID: 'project-id',
      FACTORY_BASE: f.host.base,
      FACTORY_T3_BINARY: f.host.binary,
      FACTORY_STATE: f.host.directory,
      FACTORY_PORT: '0',
      FACTORY_PREREQUISITES: JSON.stringify([
        { issue: 3, pr: 103, commit: f.d },
        { issue: 4, pr: 104, commit: f.c },
      ]),
    });
    const address = running.app.server.address();
    if (!address || typeof address === 'string') throw new Error('Missing listener');
    const context = await browser.newContext({
      recordVideo: { dir: process.env.FACTORY_DEMO_DIRECTORY ?? join(f.host.directory, 'video') },
    });
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${address.port}`);
    await browserExpect(page.getByRole('heading', { name: 'Conflict recovery #4' })).toBeVisible();
    await page.getByRole('heading', { name: 'Conflict recovery #4' }).scrollIntoViewIfNeeded();
    await browserExpect(page.getByText('Classification: COMPLEX')).toBeVisible();
    await browserExpect(page.getByText('Awaiting independent review-loop')).toBeVisible();
    await browserExpect(page.getByRole('link', { name: 'Open recovery thread' })).toHaveAttribute(
      'href',
      't3-thread://v1/restacker'
    );
    // Questions remain owned by T3. A later observation must still be incomplete.
    const resourcePath = join(f.host.directory, 'restacker.json');
    const resource = JSON.parse(await readFile(resourcePath, 'utf8'));
    resource.thread.status = 'waiting';
    resource.thread.pendingRequestCount = 1;
    await writeFile(resourcePath, JSON.stringify(resource));
    await Effect.runPromise(f.issues.prepare?.(5) ?? Effect.void);
    await page.reload();
    await browserExpect(
      page.getByText('Question: Open recovery thread to answer the pending question')
    ).toBeVisible();
    if (process.env.FACTORY_DEMO_DIRECTORY)
      await page.screenshot({
        path: join(process.env.FACTORY_DEMO_DIRECTORY, 'questions.png'),
        fullPage: true,
      });
    expect((await Effect.runPromise(f.issues.inspect(5))).blockersReady).toBe(false);
    await context.close();
  } finally {
    await running?.close();
    await browser.close();
    await f.close();
  }
});

it.each(['implementation', 'publication'] as const)(
  'retries an interrupted %s stage in its existing worker without another admission',
  async (stage) => {
    const host = await protocol();
    const previous = { path: process.env.PATH, fixture: process.env.FACTORY_FIXTURE };
    process.env.PATH = `${host.directory}:${previous.path}`;
    process.env.FACTORY_FIXTURE = host.configFile;
    const { writeFile } = await import('node:fs/promises');
    const authorization = `${host.directory}/authorization`;
    await writeFile(authorization, 'Bearer controlled-protocol');
    const browser = await chromium.launch({ headless: true });
    try {
      const running = await startFactory({
        FACTORY_PROJECT: host.repository,
        FACTORY_T3_PROJECT_ID: 'project-id',
        FACTORY_BASE: host.base,
        FACTORY_T3_BINARY: host.binary,
        FACTORY_STATE: `${host.directory}/state`,
        FACTORY_PORT: '0',
        FACTORY_T3_MCP_ENDPOINT: 'http://127.0.0.1:1/mcp',
        FACTORY_T3_MCP_AUTHORIZATION_FILE: authorization,
      });
      try {
        const page = await browser.newPage();
        const address = running.app.server.address();
        if (!address || typeof address === 'string') throw new Error('Missing listener');
        await page.goto(`http://127.0.0.1:${address.port}`);
        await page.getByLabel('Selected issue number').fill('579');
        await page.getByRole('button', { name: 'Start selected issue' }).click();
        await browserExpect(page.getByText('Status: running')).toBeVisible();
        const before = await (
          await page.request.get(`http://127.0.0.1:${address.port}/api/job`)
        ).json();
        let publication: string | undefined;
        if (stage === 'publication') {
          await host.save({
            complete: true,
            base: host.base,
            holdPublication: true,
            overrides: { status: 'completed' },
          });
          await browserExpect
            .poll(
              async () => {
                const observation = await (
                  await page.request.get(`http://127.0.0.1:${address.port}/api/job`)
                ).json();
                return {
                  stage: observation.delivery?.stage,
                  run: observation.execution?.run?.id,
                };
              }
            )
            .toEqual({ stage: 'publication', run: 'run-3' });
          publication = await readFile(join(host.directory, 'pr.json'), 'utf8');
        }
        await host.save({ overrides: { status: 'interrupted' } });
        await page.reload();
        await browserExpect(
          page.getByRole('button', { name: 'Retry existing stage' })
        ).toBeVisible();
        const navigated = page.waitForEvent('load');
        const delivered = page.waitForResponse(
          (response) =>
            response.url().endsWith('/api/job/resume') && response.request().method() === 'POST'
        );
        await page.getByRole('button', { name: 'Retry existing stage' }).click();
        expect((await delivered).status()).toBe(202);
        await navigated;
        await host.save({});
        await page.reload();
        await browserExpect(page.getByRole('button', { name: 'Retry existing stage' })).toHaveCount(
          0
        );
        const resumed = await (
          await page.request.get(`http://127.0.0.1:${address.port}/api/job`)
        ).json();
        expect(resumed.intent).toEqual(before.intent);
        expect(resumed.execution.run).toEqual(
          stage === 'publication' ? { id: 'run-4', ordinal: 4 } : { id: 'run-2', ordinal: 2 }
        );
        if (publication)
          expect(await readFile(join(host.directory, 'pr.json'), 'utf8')).toBe(publication);
        expect(resumed.delivery).toMatchObject({ stage, ready: false });
        const schedule = await (
          await page.request.get(`http://127.0.0.1:${address.port}/api/scheduler`)
        ).json();
        expect(schedule.state.admissions).toHaveLength(1);
        await page.getByRole('button', { name: 'Cancel job' }).click();
        await browserExpect(page.getByText('cancelled', { exact: true })).toBeVisible();
        expect(
          (await host.calls()).filter(
            (call) => call.args[1] === 'start' && !call.args.includes('--help')
          )
        ).toHaveLength(1);
        expect(
          (await host.calls()).filter(
            (call) => call.args[0] === 'acp-mcp-call' && call.args[1] === 't3_thread_send'
          )
        ).toHaveLength(stage === 'publication' ? 3 : 1);
      } finally {
        await running.close();
      }
    } finally {
      await browser.close();
      process.env.PATH = previous.path;
      if (previous.fixture === undefined) delete process.env.FACTORY_FIXTURE;
      else process.env.FACTORY_FIXTURE = previous.fixture;
      await host.cleanup();
    }
  }
);
