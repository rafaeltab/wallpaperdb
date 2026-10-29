import { expect, it } from 'vitest';
import { startFactory } from '../src/composition/index.js';
import { protocol } from './fixtures/setup.js';
it('validates host configuration before serving and composes the real driving and storage adapters', async () => {
  const host = await protocol();
  const configuration = {
    FACTORY_PROJECT: host.repository,
    FACTORY_T3_PROJECT_ID: 'project-id',
    FACTORY_BASE: host.base,
    FACTORY_T3_BINARY: host.binary,
    FACTORY_STATE: host.directory + '/state',
    FACTORY_PORT: '0',
  };
  try {
    await expect(startFactory({ ...configuration, FACTORY_HOST: '0.0.0.0' })).rejects.toThrow();
    await expect(
      startFactory({ ...configuration, FACTORY_HOST: '100.97.invalid.test' })
    ).rejects.toThrow();
    const previous = process.env.FACTORY_FIXTURE;
    process.env.FACTORY_FIXTURE = host.configFile;
    try {
      const running = await startFactory({ ...configuration, FACTORY_HOST: '127.0.0.1' });
      try {
        const second = await startFactory({ ...configuration, FACTORY_HOST: '127.0.0.1' });
        try {
          expect((await running.app.inject('/api/job')).json()).toEqual({ kind: 'empty' });
          expect(running.app.server.address()).not.toEqual(second.app.server.address());
        } finally {
          await second.close();
        }
      } finally {
        await running.close();
      }
    } finally {
      if (previous === undefined) delete process.env.FACTORY_FIXTURE;
      else process.env.FACTORY_FIXTURE = previous;
    }
  } finally {
    await host.cleanup();
  }
});
