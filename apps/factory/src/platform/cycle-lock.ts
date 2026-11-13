import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

/** Advisory ownership survives a caller crash only as long as its stdin remains open.
 * The kernel releases flock when the child exits, including parent process death. */
export async function acquireCycle(directory: string, signal: AbortSignal) {
  await mkdir(directory, { recursive: true });
  signal.throwIfAborted();
  const child = spawn(
    'flock',
    [
      '--exclusive',
      '--nonblock',
      join(directory, '.execution-cycle.lock'),
      'sh',
      '-c',
      'echo owned; cat >/dev/null',
    ],
    { stdio: ['pipe', 'pipe', 'pipe'] }
  );
  let released = false;
  let announced = false;
  const lost = new Promise<never>((_resolve, reject) =>
    child.once('close', () => {
      if (announced && !released) reject(new Error('Execution cycle ownership was lost'));
    })
  );
  void lost.catch(() => undefined);
  let error = '';
  child.stderr.on('data', (chunk: Buffer) => {
    error += chunk.toString();
  });
  const closed = new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', () => resolve());
  });
  void closed.catch(() => undefined);
  const abort = () => {
    child.stdin.end();
  };
  signal.addEventListener('abort', abort, { once: true });
  const release = async () => {
    released = true;
    child.stdin.end();
    await closed;
    signal.removeEventListener('abort', abort);
  };
  return await new Promise<{ release(): Promise<void>; lost: Promise<never> } | undefined>(
    (resolve, reject) => {
      child.once('error', (cause) => {
        signal.removeEventListener('abort', abort);
        reject(cause);
      });
      child.stdout.once('data', () => {
        announced = true;
        if (signal.aborted) {
          void release().then(() => reject(signal.reason));
          return;
        }
        resolve({ release, lost });
      });
      child.once('close', (code) => {
        signal.removeEventListener('abort', abort);
        if (code === 1 && !announced) resolve(undefined);
        else if (!announced && code === 0)
          reject(new Error('Execution cycle ownership was not established'));
        else if (code !== 0) reject(new Error(`Execution cycle lock failed: ${error}`));
      });
    }
  );
}
