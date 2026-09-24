import { readFile } from 'node:fs/promises';
import { Effect, Layer, ManagedRuntime, Result } from 'effect';
import { TestClock } from 'effect/testing';
import { describe, expect, it, vi } from 'vitest';
import { histogramFromImage } from '../src/adapters/image/index.js';

async function decoderProcess(): Promise<number> {
  return vi.waitFor(
    async () => {
      const children = await readFile(`/proc/${process.pid}/task/${process.pid}/children`, 'utf8');
      for (const entry of children.trim().split(/\s+/).filter(Boolean)) {
        const command = await readFile(`/proc/${entry}/cmdline`, 'utf8').catch(() => '');
        if (command.includes('/decoder.ts') || command.includes('/decoder.mjs'))
          return Number(entry);
      }
      throw new Error('No owned image decoder process observed');
    },
    { interval: 1, timeout: 2000 }
  );
}

function running(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return false;
    throw error;
  }
}

// Process inspection and SIGSTOP exercise a real nonresponsive decoder on Linux CI.
// No decoder replacement or application-only test hooks are used.
describe.skipIf(process.platform !== 'linux')('Native image process ownership', () => {
  it.each([
    'deadline',
    'interruption',
  ])('reaps a stopped decoder before %s completes', async (mode) => {
    const runtime = ManagedRuntime.make(Layer.empty.pipe(Layer.provideMerge(TestClock.layer())));
    const controller = new AbortController();
    let child: number | undefined;
    try {
      const operation = runtime.runPromise(
        Effect.result(histogramFromImage(Buffer.from('bytes'))),
        {
          signal: controller.signal,
        }
      );
      const settled = operation.then(
        (value) => ({ value }),
        (error: unknown) => ({ error })
      );
      child = await decoderProcess();
      process.kill(child, 'SIGSTOP');
      if (mode === 'deadline') await runtime.runPromise(TestClock.adjust('10 seconds'));
      else controller.abort();
      const result = await settled;
      expect(running(child)).toBe(false);
      if (mode === 'deadline') {
        expect('value' in result).toBe(true);
        if ('value' in result) {
          expect(Result.isFailure(result.value)).toBe(true);
          if (Result.isFailure(result.value)) {
            expect(result.value.failure._tag).toBe('ExtractionUnavailable');
            expect(result.value.failure.operation).toBe('decode-image');
          }
        }
      } else expect('error' in result).toBe(true);
    } finally {
      if (child !== undefined && running(child)) process.kill(child, 'SIGKILL');
      controller.abort();
      await runtime.dispose();
    }
  }, 5000);
});
