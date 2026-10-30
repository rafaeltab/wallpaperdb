import { readFile } from 'node:fs/promises';
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
