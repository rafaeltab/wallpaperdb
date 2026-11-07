import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { stopOwnedProcesses, stopProcess } from './fixtures/processes.js';
import { protocol } from './fixtures/setup.js';

it('stops a fixture writer that outlives its killed application parent before removing its directory', async (t) => {
  const host = await protocol();
  const writer = await host.nodeCommand(
    'writer',
    `const { writeFileSync } = require('node:fs');
const write = () => writeFileSync(${JSON.stringify(join(host.directory, 'late-write'))}, 'active');
write();
process.send(process.pid);
setInterval(write, 10);
`
  );
  const parent = await host.nodeCommand(
    'parent',
    `const { spawn } = require('node:child_process');
const writer = spawn(${JSON.stringify(writer)}, [], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
writer.once('message', (pid) => process.send(pid));
`
  );
  const child = spawn(parent, [], {
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  let writerPid: number | undefined;
  const active = async () => {
    if (writerPid === undefined) return false;
    try {
      const stat = await readFile(`/proc/${writerPid}/stat`, 'utf8');
      const state = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[0];
      return state !== 'Z' && state !== 'X';
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
      throw error;
    }
  };
  t.onTestFinished(async () => {
    if (child.pid) {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) throw error;
      }
    }
    await stopProcess(child);
    await vi.waitFor(async () => expect(await active()).toBe(false), {
      timeout: 10000,
      interval: 30,
    });
    await host.cleanup();
  });
  const [pid] = await once(child, 'message');
  if (typeof pid !== 'number') throw new Error('Missing owned writer PID');
  writerPid = pid;
  expect(await readFile(join(host.directory, 'late-write'), 'utf8')).toBe('active');
  await stopProcess(child);
  expect(await active()).toBe(true);
  await stopOwnedProcesses([child]);
  expect(await active()).toBe(false);
  await host.cleanup();
});
