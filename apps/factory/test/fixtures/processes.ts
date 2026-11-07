import type { ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { readFile, readdir } from 'node:fs/promises';
import { expect, vi } from 'vitest';

export async function stopProcess(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exit = once(child, 'exit');
  child.kill('SIGKILL');
  await exit;
}

export async function stopOwnedProcesses(children: readonly ChildProcess[]) {
  // Recovery steps stop only the parent. Final teardown also stops every
  // descendant in the detached groups before their fixture files are removed.
  for (const child of children) {
    if (!child.pid) continue;
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) throw error;
    }
  }
  await Promise.all(children.map(stopProcess));
  const groups = new Set(children.map((child) => String(child.pid)));
  await vi.waitFor(
    async () => {
      const entries = (await readdir('/proc')).filter((entry) => /^\d+$/.test(entry));
      const members = await Promise.all(
        entries.map(async (pid) => {
          let stat: string;
          try {
            stat = await readFile(`/proc/${pid}/stat`, 'utf8');
          } catch (error) {
            if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return;
            throw error;
          }
          const [state, , group] = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
          return group && groups.has(group) && state !== 'Z' && state !== 'X' ? pid : undefined;
        })
      );
      expect(members.filter((pid) => pid !== undefined)).toEqual([]);
    },
    { timeout: 10000, interval: 30 }
  );
}
