import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { startFactory } from '../src/composition/index.js';
import { protocol } from './fixtures/setup.js';

it('rejects incompatible durable state before consulting external services and preserves it', async () => {
  const host = await protocol();
  const state = join(host.directory, 'state');
  await mkdir(state);
  const manifest = '{"format":2}';
  await writeFile(join(state, 'format.json'), manifest);
  try {
    await expect(
      startFactory({
        FACTORY_PROJECT: host.repository,
        FACTORY_T3_PROJECT_ID: 'project-id',
        FACTORY_BASE: host.base,
        FACTORY_T3_BINARY: '/missing/t3',
        FACTORY_STATE: state,
        FACTORY_PORT: '0',
      })
    ).rejects.toThrow(/state format.*compatible installation/i);
    expect(await readFile(join(state, 'format.json'), 'utf8')).toBe(manifest);
  } finally {
    await host.cleanup();
  }
});

it('adopts pre-manifest state without discarding controls or reservations', async () => {
  const host = await protocol();
  const previous = process.env.FACTORY_FIXTURE;
  process.env.FACTORY_FIXTURE = host.configFile;
  const state = join(host.directory, 'state');
  await mkdir(state);
  const controls = JSON.stringify({
    revision: 0,
    concurrency: 2,
    allowance: 1,
    paused: true,
    admissions: [],
  });
  await writeFile(join(state, 'schedule-0.json'), controls);
  try {
    const running = await startFactory({
      FACTORY_PROJECT: host.repository,
      FACTORY_T3_PROJECT_ID: 'project-id',
      FACTORY_BASE: host.base,
      FACTORY_T3_BINARY: host.binary,
      FACTORY_STATE: state,
      FACTORY_PORT: '0',
    });
    try {
      expect((await running.app.inject('/api/scheduler')).json()).toMatchObject({
        state: { concurrency: 2, allowance: 1, paused: true, admissions: [] },
      });
      expect(JSON.parse(await readFile(join(state, 'format.json'), 'utf8'))).toEqual({ format: 1 });
      expect(await readFile(join(state, 'schedule-0.json'), 'utf8')).toBe(controls);
    } finally {
      await running.close();
    }
  } finally {
    if (previous === undefined) delete process.env.FACTORY_FIXTURE;
    else process.env.FACTORY_FIXTURE = previous;
    await host.cleanup();
  }
});
