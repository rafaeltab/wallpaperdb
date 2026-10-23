import { spawn, type StdioOptions } from 'node:child_process';
import { once } from 'node:events';
import { readlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
const response = z.object({
  id: z.number().int(),
  result: z.unknown().optional(),
  error: z.string().optional(),
});
/** Owns one Asset test process. Its private stdin controls dependencies; all
 * application interactions cross the real HTTP and protected NATS boundaries. */
export function assetFixture() {
  const stdio: StdioOptions = ['pipe', 'pipe', 'pipe'];
  const inherited = Number(process.env.WALLPAPERDB_DOCKER_LEASE_FD);
  try {
    if (
      Number.isSafeInteger(inherited) &&
      inherited >= 3 &&
      readlinkSync(`/proc/self/fd/${inherited}`) === process.env.WALLPAPERDB_DOCKER_LEASE_FILE
    ) {
      while (stdio.length <= inherited) stdio.push('ignore');
      stdio[inherited] = inherited;
    }
  } catch {
    /* Plain test-focused need not inherit a nested coordinated command lease. */
  }
  const child = spawn('make', ['run', 'PACKAGE=asset', 'SCRIPT=test:attachment-fixture'], {
    cwd: fileURLToPath(new URL('../../../../', import.meta.url)),
    stdio,
    detached: true,
  });
  const input = child.stdin;
  const output = child.stdout;
  const errors = child.stderr;
  if (!input || !output || !errors) throw new Error('Missing owned fixture pipes');
  let sequence = 0;
  let buffer = '';
  let diagnostics = '';
  let exited = false;
  const pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (cause: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  const fail = (error: Error) => {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    pending.clear();
  };
  const completed = once(child, 'close').then(([code]) => {
    exited = true;
    fail(new Error(`Asset fixture exited (${code}): ${diagnostics}`));
    return code;
  });
  errors.on('data', (data) => {
    diagnostics += String(data);
    if (diagnostics.length > 65536) {
      diagnostics = diagnostics.slice(0, 65536);
      fail(new Error('Asset fixture diagnostic limit exceeded'));
    }
  });
  output.on('data', (data) => {
    buffer += String(data);
    if (buffer.length > 65536) {
      fail(new Error('Asset fixture line limit exceeded'));
      buffer = '';
      return;
    }
    while (true) {
      const newline = buffer.indexOf('\n');
      if (newline < 0) break;
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (!line.startsWith('ATTACHMENT_FIXTURE ')) continue;
      const parsed = response.safeParse(JSON.parse(line.slice('ATTACHMENT_FIXTURE '.length)));
      if (!parsed.success) {
        fail(new Error('Invalid fixture response'));
        continue;
      }
      const entry = pending.get(parsed.data.id);
      if (!entry) continue;
      pending.delete(parsed.data.id);
      clearTimeout(entry.timer);
      if (parsed.data.error) entry.reject(new Error(parsed.data.error + ': ' + diagnostics));
      else entry.resolve(parsed.data.result);
    }
  });
  child.on('error', (error) => fail(error));
  input.on('error', (error) => fail(error));
  const call = (operation: string, options?: unknown) =>
    new Promise<unknown>((resolve, reject) => {
      if (exited) {
        reject(new Error('Asset fixture already exited'));
        return;
      }
      const id = ++sequence;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Asset fixture ${operation} timed out: ${diagnostics}`));
      }, 30000);
      pending.set(id, { resolve, reject, timer });
      input.write(JSON.stringify({ id, operation, ...(options ? { options } : {}) }) + '\n');
    });
  const wait = async (ms: number) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        completed,
        new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), ms);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
  const terminate = (signal: NodeJS.Signals) => {
    if (!exited && child.pid) process.kill(-child.pid, signal);
  };
  return {
    call,
    close: async () => {
      let failure: unknown;
      try {
        if (!exited) await call('close');
      } catch (error) {
        failure = error;
      } finally {
        input.end();
        if ((await wait(5000)) === null) {
          terminate('SIGTERM');
          if ((await wait(5000)) === null) terminate('SIGKILL');
        }
        const code = await completed;
        if (code !== 0 && !failure)
          failure = new Error(`Asset fixture exited ${code}: ${diagnostics}`);
      }
      if (failure) throw failure;
    },
  };
}
