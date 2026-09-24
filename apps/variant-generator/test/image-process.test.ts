import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { Effect, Layer, ManagedRuntime, Result } from 'effect';
import { TestClock } from 'effect/testing';
import { describe, expect, it, vi } from 'vitest';
import { imageLayer } from '../src/adapters/image/index.js';
import { VariantImages } from '../src/generation/index.js';

async function encoderProcess(): Promise<number> {
  return vi.waitFor(
    async () => {
      const children = await readFile(`/proc/${process.pid}/task/${process.pid}/children`, 'utf8');
      for (const entry of children.trim().split(/\s+/).filter(Boolean)) {
        const command = await readFile(`/proc/${entry}/cmdline`, 'utf8').catch(() => '');
        if (command.includes('/encoder.ts') || command.includes('/encoder.mjs'))
          return Number(entry);
      }
      throw new Error('No owned image encoder process observed');
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

// Process inspection and SIGSTOP exercise a real nonresponsive encoder on Linux CI.
// No encoder replacement or application-only test hooks are used.
describe.skipIf(process.platform !== 'linux')('Native image process ownership', () => {
  it.each([
    'deadline',
    'interruption',
  ])('reaps a stopped encoder before %s completes', async (mode) => {
    const server = createServer((_request, response) => response.end('image bytes'));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing HTTP address');
    const runtime = ManagedRuntime.make(imageLayer({
      endpoint: `http://127.0.0.1:${address.port}`, region: 'us-east-1', accessKeyId: 'test',
      secretAccessKey: 'test', bucket: 'wallpapers', jpegQuality: 90, pngCompressionLevel: 6, webpQuality: 90,
    }).pipe(Layer.provideMerge(TestClock.layer())));
    const controller = new AbortController();
    let child: number | undefined;
    try {
      const operation = runtime.runPromise(
        Effect.result(Effect.gen(function* () {
          return yield* (yield* VariantImages).generate({
            wallpaperId: 'wlpr_process', fileType: 'image', mimeType: 'image/jpeg', width: 160, height: 90,
            storage: { bucket: 'wallpapers', key: 'original.jpg' }, occurrence: { source: 'test', id: 'process' },
            timestamp: '2026-01-01T00:00:00.000Z',
          }, { width: 80, height: 45, label: 'small' });
        })),
        {
          signal: controller.signal,
        }
      );
      const settled = operation.then(
        (value) => ({ value }),
        (error: unknown) => ({ error })
      );
      child = await encoderProcess();
      process.kill(child, 'SIGSTOP');
      if (mode === 'deadline') await runtime.runPromise(TestClock.adjust('60 seconds'));
      else controller.abort();
      const result = await settled;
      expect(running(child)).toBe(false);
      if (mode === 'deadline') {
        expect('value' in result).toBe(true);
        if ('value' in result) {
          expect(Result.isFailure(result.value)).toBe(true);
          if (Result.isFailure(result.value)) {
            expect(result.value.failure._tag).toBe('GenerationUnavailable');
            expect(result.value.failure.operation).toBe('encode-image');
          }
        }
      } else expect('error' in result).toBe(true);
    } finally {
      if (child !== undefined && running(child)) process.kill(child, 'SIGKILL');
      controller.abort();
      await runtime.dispose();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  }, 5000);
});
