import { createServer } from 'node:http';
import { Effect, ManagedRuntime, Result } from 'effect';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { imageLayer } from '../src/adapters/image/index.js';
import { ImageHistogram } from '../src/extraction/index.js';

const maxImageBytes = 50 * 1024 * 1024;

describe('Stored image byte limit', () => {
  it.each([
    'unknown length',
    'oversized advertised length',
    'exact boundary',
  ])('%s is bounded while retaining accepted images', async (scenario) => {
    const png = await sharp({
      create: { width: 1, height: 1, channels: 3, background: { r: 255, g: 0, b: 0 } },
    })
      .png()
      .toBuffer();
    let observedClose = () => {};
    const closed = new Promise<void>((resolve) => {
      observedClose = resolve;
    });
    const server = createServer((_request, response) => {
      response.on('close', observedClose);
      if (scenario === 'oversized advertised length') {
        response.writeHead(200, { 'Content-Length': maxImageBytes + 1 });
        response.flushHeaders();
      } else if (scenario === 'unknown length') {
        // Leave the chunked response open: failure must stop reading before EOF.
        response.write(Buffer.alloc(maxImageBytes + 1));
      } else {
        const bytes = Buffer.alloc(maxImageBytes);
        png.copy(bytes);
        response.end(bytes);
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing HTTP address');
    const runtime = ManagedRuntime.make(
      imageLayer({
        endpoint: `http://127.0.0.1:${address.port}`,
        region: 'us-east-1',
        accessKeyId: 'test',
        secretAccessKey: 'test',
        bucket: 'wallpapers',
      })
    );
    try {
      const result = await runtime.runPromise(
        Effect.result(
          Effect.gen(function* () {
            return yield* (yield* ImageHistogram).extract({
              bucket: 'wallpapers',
              key: 'image.png',
            });
          })
        ),
        { signal: AbortSignal.timeout(10000) }
      );
      if (scenario === 'exact boundary') {
        expect(Result.isSuccess(result)).toBe(true);
        if (Result.isSuccess(result)) expect(result.success[3]).toBe(1);
      } else {
        expect(Result.isFailure(result)).toBe(true);
        if (Result.isFailure(result)) {
          expect(result.failure._tag).toBe('ExtractionUnavailable');
          expect(result.failure.operation).toBe('read-image');
          expect(result.failure.cause).toEqual(new Error('Stored image exceeds 50 MiB'));
        }
      }
      await closed;
    } finally {
      await runtime.dispose();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  }, 15000);
});
