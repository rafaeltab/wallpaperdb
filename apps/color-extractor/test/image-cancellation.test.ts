import { createServer } from 'node:http';
import { Effect, Layer, ManagedRuntime, Result } from 'effect';
import { TestClock } from 'effect/testing';
import { describe, expect, it } from 'vitest';
import { ImageHealth, imageLayer } from '../src/adapters/image/index.js';
import { ImageHistogram } from '../src/extraction/index.js';

describe('Image storage request ownership', () => {
  it.each([
    { phase: 'headers', deadline: false, health: false },
    { phase: 'body', deadline: false, health: false },
    { phase: 'body', deadline: true, health: false },
    { phase: 'headers', deadline: true, health: true },
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
    const server = createServer((_request, response) => {
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
        bucket: 'wallpapers',
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
                  return yield* (yield* ImageHistogram).extract({
                    bucket: 'wallpapers',
                    key: 'waiting.png',
                  });
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
                expect(result.value.failure.operation).toBe('extract-image');
              }
            }
          }
        }
      } else {
        const operation = runtime.runPromise(
          Effect.gen(function* () {
            return yield* (yield* ImageHistogram).extract({
              bucket: 'wallpapers',
              key: 'waiting.png',
            });
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
