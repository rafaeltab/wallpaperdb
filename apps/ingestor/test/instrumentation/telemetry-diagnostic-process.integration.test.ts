import { fork } from 'node:child_process';
import { expect, it } from 'vitest';

it('completes real exports and cleanup after the diagnostic stderr reader closes', async () => {
  const child = fork(new URL('./fixtures/telemetry-diagnostic-process.ts', import.meta.url), [], {
    execArgv: ['--import', import.meta.resolve('tsx')],
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  const messages: string[] = [];
  let diagnostics = '';
  child.stderr?.setEncoding('utf8').on('data', (chunk: string) => {
    diagnostics += chunk;
  });
  try {
    const exit = await new Promise<{ code: number | null; signal: string | null }>(
      (resolve, reject) => {
        const deadline = setTimeout(() => {
          child.kill('SIGKILL');
          reject(new Error(`Diagnostic subprocess timed out: ${messages.join(', ')}`));
        }, 5000);
        child.once('error', reject);
        child.once('close', (code, signal) => {
          clearTimeout(deadline);
          resolve({ code, signal });
        });
        child.on('message', (message) => {
          if (typeof message !== 'string') return;
          messages.push(message);
          if (message === 'ready') {
            child.stderr?.once('close', () => child.send('export'));
            child.stderr?.destroy();
          }
        });
      }
    );
    expect(exit, JSON.stringify({ messages, diagnostics })).toEqual({ code: 0, signal: null });
    expect(messages).toEqual(['ready', 'export-code=1', 'application-alive', 'cleanup-complete']);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
});
