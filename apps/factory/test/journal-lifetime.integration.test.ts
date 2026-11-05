import fs from 'node:fs';
import { Effect } from 'effect';
import { expect, it } from 'vitest';
import { startFactory } from '../src/composition/index.js';
import { fileScheduleStore } from '../src/adapters/store/index.js';
import { joinFixture } from './fixtures/join.js';

it('closes SQLite recovery composition without dispatching parked writers', async () => {
  const f = await joinFixture({ conflict: true, restack: { outcome: 'SIMPLE' } });
  let running: Awaited<ReturnType<typeof startFactory>> | undefined;
  try {
    await Effect.runPromise(f.issues.prepare?.(5) ?? Effect.void);
    const owning = `${f.host.directory}/owning-C`;
    f.git('worktree', 'add', owning, 'C');
    await fs.promises.writeFile(`${owning}/writer.txt`, 'retained uncommitted work');
    await Effect.runPromise(
      fileScheduleStore(f.host.directory).save({
        revision: 0,
        concurrency: 1,
        allowance: 1,
        paused: true,
        admissions: [],
      })
    );
    running = await startFactory({
      FACTORY_PROJECT: f.host.repository,
      FACTORY_T3_PROJECT_ID: 'project-id',
      FACTORY_BASE: f.host.base,
      FACTORY_T3_BINARY: f.host.binary,
      FACTORY_STATE: f.host.directory,
      FACTORY_PORT: '0',
    });
    expect((await running.app.inject('/health')).statusCode).toBe(200);
    await running.close();
    expect(
      (await f.host.calls()).filter(
        (call) =>
          call.binary === 't3' &&
          ['start', 'send'].includes(call.args[1]) &&
          !call.args.includes('--help')
      )
    ).toEqual([]);
  } finally {
    await running?.close();
    await f.close();
  }
});
