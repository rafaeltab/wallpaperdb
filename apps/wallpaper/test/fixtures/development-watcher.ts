import { spawn } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { expect, vi } from 'vitest';

/** Run the image's exact watch command in an owned source copy and own its process group. */
export function startDevelopmentWatcher(
  dockerfile: string,
  directory: string,
  environment: Record<string, string>
) {
  const instruction = dockerfile.match(/^CMD (\[.*\])$/m)?.[1];
  if (!instruction) throw new Error('Missing development image command');
  const command: unknown = JSON.parse(instruction);
  if (
    !Array.isArray(command) ||
    !command.every((part): part is string => typeof part === 'string')
  ) {
    throw new Error('Invalid development image command');
  }
  const [program, ...args] = command;
  if (!program) throw new Error('Empty development image command');
  let output = '';
  let exit: { code: number | null; signal: NodeJS.Signals | null } | undefined;
  const child = spawn(program, args, {
    cwd: directory,
    detached: true,
    env: {
      ...Object.fromEntries(
        Object.entries(process.env).filter(
          ([name]) =>
            !name.startsWith('OTEL_') && !name.startsWith('DOTENV_') && name !== 'NODE_OPTIONS'
        )
      ),
      NODE_ENV: 'development',
      ...environment,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  console.info('Owned development watcher', { pid: child.pid, command, directory });
  child.stdout.on('data', (chunk: Buffer) => {
    output = (output + chunk.toString()).slice(-65536);
  });
  child.stderr.on('data', (chunk: Buffer) => {
    output = (output + chunk.toString()).slice(-65536);
  });
  child.once('close', (code, signal) => {
    exit = { code, signal };
  });
  child.once('error', (cause) => {
    output += cause.message;
  });
  async function members() {
    const processes = await Promise.all(
      (await readdir('/proc'))
        .filter((pid) => /^\d+$/.test(pid))
        .map(async (pid) => {
          try {
            const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
            const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
            return Number(fields[2]) === child.pid
              ? { pid: Number(pid), state: fields[0] }
              : undefined;
          } catch (cause) {
            if (
              cause instanceof Error &&
              'code' in cause &&
              (cause.code === 'ENOENT' || cause.code === 'ESRCH')
            )
              return undefined;
            throw cause;
          }
        })
    );
    return processes.filter((process) => process !== undefined);
  }
  let stopping: Promise<void> | undefined;
  return {
    output: () => output,
    recordProcesses: async (phase: string) =>
      console.info('Owned watch process group', { phase, members: await members() }),
    stop: () => {
      stopping ??= (async () => {
        if (!exit) child.kill('SIGTERM');
        try {
          await vi.waitFor(() => expect(exit, output).toBeDefined(), { timeout: 10000 });
          await expect.poll(members, { timeout: 3000 }).toEqual([]);
        } finally {
          const remaining = await members();
          if (remaining.length && child.pid) {
            process.kill(-child.pid, 'SIGKILL');
            await vi.waitFor(() => expect(exit, output).toBeDefined(), { timeout: 3000 });
            await expect.poll(members, { timeout: 3000 }).toEqual([]);
          }
          console.info('Reaped development watcher', {
            pid: child.pid,
            exit,
            remaining: await members(),
            output,
          });
        }
      })();
      return stopping;
    },
  };
}
