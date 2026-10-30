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
      expect(
        (await host.calls()).filter((call) => call.binary === 't3' && call.args[1] === 'send')
      ).toHaveLength(2);
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
