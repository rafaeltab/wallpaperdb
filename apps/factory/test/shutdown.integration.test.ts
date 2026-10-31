import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { startFactory } from '../src/composition/index.js';
import { protocol } from './fixtures/setup.js';
it('bounds HTTP draining and cancels the underlying observer process while preserving external work', async () => {
  const host = await protocol();
  const oldPath = process.env.PATH;
  const oldFixture = process.env.FACTORY_FIXTURE;
  process.env.PATH = host.directory + ':' + oldPath;
  process.env.FACTORY_FIXTURE = host.configFile;
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
      const address = running.app.server.address();
      if (!address || typeof address === 'string') throw new Error('Missing address');
      const origin = `http://127.0.0.1:${address.port}`;
      expect(
        (
          await fetch(origin + '/api/job', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ issue: 576 }),
          })
        ).status
      ).toBe(202);
      await host.save({ delayObserve: true });
      const request = fetch(origin + '/api/job')
        .then((response) => response.text())
        .catch(() => null);
      let pid = 0;
      await vi.waitFor(async () => {
        pid = Number(await readFile(join(host.directory, 'observing.pid'), 'utf8'));
        expect(pid).toBeGreaterThan(0);
      });
      const started = performance.now();
      await running.close();
      expect(performance.now() - started).toBeLessThan(8000);
      await request;
      await vi.waitFor(() => expect(() => process.kill(pid, 0)).toThrow(), { timeout: 1000 });
      expect(
        JSON.parse(await readFile(join(host.directory, 'resource.json'), 'utf8'))
      ).toMatchObject({ threadId: 'thread-live', status: 'running' });
    } finally {
      await running.close();
    }
  } finally {
    process.env.PATH = oldPath;
    if (oldFixture === undefined) delete process.env.FACTORY_FIXTURE;
    else process.env.FACTORY_FIXTURE = oldFixture;
    await host.cleanup();
  }
});
