import { fork } from 'node:child_process';
import { expect, it } from 'vitest';

async function runDiagnosticProcess(
  mode: 'closed-reader' | 'healthy-reader' | 'application-write'
) {
  const child = fork(
    new URL('./fixtures/telemetry-diagnostic-process.ts', import.meta.url),
    [mode],
    {
      execArgv: ['--import', import.meta.resolve('tsx')],
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    }
  );
  const messages: string[] = [];
  let diagnostics = '';
  let output = '';
  child.stdout?.setEncoding('utf8').on('data', (chunk: string) => {
    output += chunk;
  });
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
            if (mode !== 'healthy-reader') {
              child.stderr?.once('close', () => child.send('export'));
              child.stderr?.destroy();
            } else child.send('export');
          }
        });
      }
    );
    return { exit, messages, diagnostics, output };
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
}

it('completes real exports and cleanup after the diagnostic stderr reader closes', async () => {
  const result = await runDiagnosticProcess('closed-reader');
  expect(result.exit, JSON.stringify(result)).toEqual({ code: 0, signal: null });
  expect(result.messages).toEqual([
    'ready',
    'export-code=1',
    'export-code=1',
    'application-alive',
    'cleanup-complete',
  ]);
});

it('leaves application stderr usable and listeners unchanged after multiple transports close', async () => {
  const result = await runDiagnosticProcess('healthy-reader');
  expect(result.exit, JSON.stringify(result)).toEqual({ code: 0, signal: null });
  expect(result.messages).toContain('cleanup-complete');
  const lines = result.diagnostics.trim().split('\n');
  expect(lines).toContain('application-stderr-after-close');
  expect(lines.filter((line) => line.startsWith('telemetry ')).length).toBeGreaterThan(0);
  expect(
    lines.every(
      (line) =>
        line === 'telemetry export unavailable; bounded best-effort export' ||
        line === 'application-stderr-after-close'
    )
  ).toBe(true);
});

it('preserves an unrelated application stderr write error while transports are active', async () => {
  const result = await runDiagnosticProcess('application-write');
  expect(result.messages).toContain('application-alive');
  expect(result.output).toBe('uncaught=EPIPE\n');
  expect(result.exit).toEqual({ code: 1, signal: null });
  expect(result.messages).not.toContain('cleanup-complete');
});
