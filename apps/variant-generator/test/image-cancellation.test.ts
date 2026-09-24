import { createServer } from 'node:http';
import { Effect, Layer, ManagedRuntime, Result } from 'effect';
import { TestClock } from 'effect/testing';
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { ImageHealth, imageLayer } from '../src/adapters/image/index.js';
import { VariantImages } from '../src/generation/index.js';

const input = { wallpaperId: 'wlpr_cancel', fileType: 'image' as const, mimeType: 'image/png', width: 160, height: 90, storage: { bucket: 'wallpapers', key: 'waiting.png' }, occurrence: { source: 'test', id: 'cancel' }, timestamp: '2026-01-01T00:00:00.000Z' };
const preset = { width: 80, height: 45, label: 'small' };

describe('Image storage request ownership', () => {
  it.each([
    { phase: 'headers', deadline: false, health: false },
    { phase: 'body', deadline: false, health: false },
    { phase: 'body', deadline: true, health: false },
    { phase: 'headers', deadline: true, health: true },
    { phase: 'upload', deadline: false, health: false },
    { phase: 'upload', deadline: true, health: false },
  ])('closes pending socket $phase deadline=$deadline health=$health', async ({
    phase,
    deadline,
    health,
  }) => {
    let observedRequest = () => {};
    const requested = new Promise<void>((resolve) => {
      observedRequest = resolve;
    });
    let observedClose = () => {};
    const closed = new Promise<void>((resolve) => {
      observedClose = resolve;
    });
    const png = await sharp({ create: { width: 16, height: 9, channels: 3, background: '#fff' } }).png().toBuffer();
    const server = createServer((request, response) => {
      if (phase === 'upload' && request.method === 'GET') {
        response.writeHead(200, { 'Content-Length': png.length });
        response.end(png);
        return;
      }
      response.on('close', observedClose);
      if (phase === 'body') {
        response.writeHead(200, { 'Content-Length': '100000' });
        response.write('partial image');
      }
      observedRequest();
    });
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing HTTP address');
    const runtime = ManagedRuntime.make(
      imageLayer({
        endpoint: `http://127.0.0.1:${address.port}`,
        region: 'us-east-1',
        accessKeyId: 'test',
        secretAccessKey: 'test',
        bucket: 'wallpapers', jpegQuality: 90, pngCompressionLevel: 6, webpQuality: 90,
      }).pipe(Layer.provideMerge(TestClock.layer()))
    );
    const controller = new AbortController();
    try {
      if (deadline) {
        // A real-time abort is a test failure bound, not the deadline under test.
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(1000)]);
        const operation = health
          ? runtime.runPromise(
              Effect.gen(function* () {
                return yield* (yield* ImageHealth).check();
              }),
              { signal }
            )
          : runtime.runPromise(
              Effect.result(
                Effect.gen(function* () {
                  return yield* (yield* VariantImages).generate(input, preset);
                })
              ),
              { signal }
            );
        const settled = operation.then(
          (value) => ({ value }),
          (error: unknown) => ({ error })
        );
        await requested;
        await runtime.runPromise(TestClock.adjust(health ? '5 seconds' : '100 seconds'));
        const result = await settled;
        expect('value' in result).toBe(true);
        if ('value' in result) {
          if (health) expect(result.value).toBe(false);
          else {
            expect(typeof result.value).not.toBe('boolean');
            if (typeof result.value !== 'boolean') {
              expect(Result.isFailure(result.value)).toBe(true);
              if (Result.isFailure(result.value)) {
                expect(result.value.failure.operation).toBe('generate-image');
              }
            }
          }
        }
      } else {
        const operation = runtime.runPromise(
          Effect.gen(function* () {
            return yield* (yield* VariantImages).generate(input, preset);
          }),
          { signal: controller.signal }
        );
        const rejected = expect(operation).rejects.toBeDefined();
        await requested;
        controller.abort();
        await rejected;
      }
      await closed;
    } finally {
      controller.abort();
      await runtime.dispose();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  }, 5000);
});


describe('Image input byte limits', () => {
  it('rejects oversized chunked bodies without trusting Content-Length', async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'Transfer-Encoding': 'chunked' });
      response.write(Buffer.alloc(50 * 1024 * 1024 + 1));
      // Keep the response open: the byte limit must terminate the read itself.
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing HTTP address');
    const runtime = ManagedRuntime.make(imageLayer({
      endpoint: `http://127.0.0.1:${address.port}`, region: 'us-east-1', accessKeyId: 'test',
      secretAccessKey: 'test', bucket: 'wallpapers', jpegQuality: 90, pngCompressionLevel: 6, webpQuality: 90,
    }));
    try {
      const result = await runtime.runPromise(Effect.result(Effect.gen(function* () {
        return yield* (yield* VariantImages).generate(input, preset);
      })), { signal: AbortSignal.timeout(3000) });
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) expect(result.failure.operation).toBe('read-image');
    } finally {
      await runtime.dispose();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
