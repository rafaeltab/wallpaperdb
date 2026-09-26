import { createServer } from 'node:http';
import { Effect, ManagedRuntime } from 'effect';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import { ImageTransformer, PictureAuthority } from '../src/delivery/index.js';
import { pictureAuthorityLayer, sharpTransformerLayer } from '../src/adapters/assets/index.js';

async function bytes(body: AsyncIterable<Uint8Array>) {
  const chunks = [];
  for await (const chunk of body) chunks.push(chunk);
  return Buffer.concat(chunks);
}
async function* stream(value: Uint8Array) {
  yield value;
}

describe('production asset adapters', () => {
  it.each([
    { fit: 'cover' as const, width: 20, height: 20 },
    { fit: 'fill' as const, width: 160, height: 100 },
  ])('encodes $fit with the requested pixel dimensions', async (options) => {
    const input = await sharp({ create: { width: 80, height: 40, channels: 3, background: 'red' } })
      .webp()
      .toBuffer();
    const output = await Effect.runPromise(
      Effect.flatMap(ImageTransformer, (t) =>
        t.resize(Object.assign(stream(input), { close() {} }), {
          ...options,
          mimeType: 'image/webp',
        })
      ).pipe(
        Effect.flatMap((body) => Effect.promise(() => bytes(body))),
        Effect.provide(sharpTransformerLayer({ maxInputPixels: 100000 }))
      )
    );
    expect(await sharp(output).metadata()).toMatchObject({
      width: options.width,
      height: options.height,
      format: 'webp',
    });
  });
  it('propagates malformed image failures to stream consumers', async () => {
    await expect(
      Effect.runPromise(
        Effect.flatMap(ImageTransformer, (t) =>
          t.resize(Object.assign(stream(new Uint8Array([1, 2, 3])), { close() {} }), {
            width: 20,
            fit: 'contain',
            mimeType: 'image/png',
          })
        ).pipe(
          Effect.flatMap((body) => Effect.promise(() => bytes(body))),
          Effect.provide(sharpTransformerLayer({ maxInputPixels: 100000 }))
        )
      )
    ).rejects.toThrow('Image encoding failed');
  });
  it('releases resize capacity and input on client cancellation', async () => {
    const runtime = ManagedRuntime.make(
      sharpTransformerLayer({ maxInputPixels: 100000, maxConcurrent: 1 })
    );
    let closed = false;
    let release = () => {};
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const input = {
      close() {
        closed = true;
        release();
      },
      async *[Symbol.asyncIterator]() {
        await waiting;
      },
    };
    try {
      const first = await runtime.runPromise(
        Effect.flatMap(ImageTransformer, (t) =>
          t.resize(input, { width: 20, fit: 'contain', mimeType: 'image/png' })
        )
      );
      await expect(
        runtime.runPromise(
          Effect.flatMap(ImageTransformer, (t) =>
            t.resize(Object.assign(stream(new Uint8Array()), { close() {} }), {
              width: 20,
              fit: 'contain',
              mimeType: 'image/png',
            })
          )
        )
      ).rejects.toMatchObject({ operation: 'resize_capacity' });
      first.close();
      await vi.waitFor(() => expect(closed).toBe(true));
      const image = await sharp({
        create: { width: 20, height: 10, channels: 3, background: 'blue' },
      })
        .png()
        .toBuffer();
      await vi.waitFor(async () => {
        const output = await runtime.runPromise(
          Effect.flatMap(ImageTransformer, (t) =>
            t.resize(Object.assign(stream(image), { close() {} }), {
              width: 10,
              fit: 'contain',
              mimeType: 'image/png',
            })
          )
        );
        expect(await sharp(await bytes(output)).metadata()).toMatchObject({ width: 10, height: 5 });
      });
    } finally {
      await runtime.dispose();
    }
  });
  it('uses authoritative availability and fails closed for unexpected responses', async () => {
    let status = 204;
    const seen: string[] = [];
    const server = createServer((req, res) => {
      seen.push(req.headers.authorization ?? '');
      res.writeHead(status).end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('missing port');
      const layer = pictureAuthorityLayer({
        origin: `http://127.0.0.1:${address.port}`,
        token: 'private-token',
        timeoutMs: 1000,
      });
      const check = Effect.flatMap(PictureAuthority, (a) => a.isAvailable('pic_1')).pipe(
        Effect.provide(layer)
      );
      expect(await Effect.runPromise(check)).toBe(true);
      status = 404;
      expect(await Effect.runPromise(check)).toBe(false);
      status = 500;
      await expect(Effect.runPromise(check)).rejects.toMatchObject({ _tag: 'DeliveryUnavailable' });
      expect(seen).toEqual([
        'Bearer private-token',
        'Bearer private-token',
        'Bearer private-token',
      ]);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
  it('resizes actual image bytes without enlarging contain images', async () => {
    const input = await sharp({ create: { width: 80, height: 40, channels: 3, background: 'red' } })
      .png()
      .toBuffer();
    const output = await Effect.runPromise(
      Effect.flatMap(ImageTransformer, (t) =>
        t.resize(Object.assign(stream(input), { close() {} }), {
          width: 160,
          height: 100,
          fit: 'contain',
          mimeType: 'image/png',
        })
      ).pipe(
        Effect.flatMap((body) => Effect.promise(() => bytes(body))),
        Effect.provide(sharpTransformerLayer({ maxInputPixels: 100000 }))
      )
    );
    expect(await sharp(output).metadata()).toMatchObject({ width: 80, height: 40, format: 'png' });
  });
});
