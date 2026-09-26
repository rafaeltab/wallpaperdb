import { createServer } from 'node:http';
import { Effect, Layer, Logger, ManagedRuntime, Tracer } from 'effect';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import { AssetReader, ImageTransformer, PictureAuthority } from '../src/delivery/index.js';
import {
  pictureAuthorityLayer,
  sharpTransformerLayer,
  s3AssetsLayer,
} from '../src/adapters/assets/index.js';

async function bytes(body: AsyncIterable<Uint8Array>) {
  const chunks = [];
  for await (const chunk of body) chunks.push(chunk);
  return Buffer.concat(chunks);
}
async function* stream(value: Uint8Array) {
  yield value;
}

describe('production asset adapters', () => {
  it('keeps the resize trace open until native work completes', async () => {
    const spans: Tracer.Span[] = [];
    const tracer = Tracer.make({
      span(options) {
        const span = Tracer.nativeTracer.span(options);
        spans.push(span);
        return span;
      },
    });
    const runtime = ManagedRuntime.make(sharpTransformerLayer({ maxInputPixels: 100000 }));
    let release = () => {};
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    const image = await sharp({
      create: { width: 20, height: 10, channels: 3, background: 'blue' },
    })
      .png()
      .toBuffer();
    const input = {
      close() {
        release();
      },
      async *[Symbol.asyncIterator]() {
        await ready;
        yield image;
      },
    };
    try {
      const body = await runtime.runPromise(
        Effect.flatMap(ImageTransformer, (transformer) =>
          transformer.resize(input, { width: 10, fit: 'contain', mimeType: 'image/png' })
        ).pipe(Effect.withTracer(tracer))
      );
      await vi.waitFor(() => expect(spans.length).toBeGreaterThan(0));
      expect(spans.every((span) => span.status._tag === 'Started')).toBe(true);
      release();
      await bytes(body);
      await vi.waitFor(() =>
        expect(spans.every((span) => span.status._tag === 'Ended')).toBe(true)
      );
    } finally {
      await runtime.dispose();
    }
  });

  it('records a bounded actionable diagnostic for rejected native image input', async () => {
    const entries: unknown[] = [];
    const logger = Logger.make<unknown, void>((options) => {
      entries.push(options.message);
    });
    const layer = sharpTransformerLayer({ maxInputPixels: 100000 }).pipe(
      Layer.provideMerge(Logger.layer([logger]))
    );
    const runtime = ManagedRuntime.make(layer);
    try {
      const input = Object.assign(stream(Buffer.from('private-upload-marker')), { close() {} });
      const body = await runtime.runPromise(
        Effect.flatMap(ImageTransformer, (transformer) =>
          transformer.resize(input, { width: 20, fit: 'contain', mimeType: 'image/png' })
        )
      );
      await expect(bytes(body)).rejects.toThrow('Image encoding failed');
      await vi.waitFor(() => expect(JSON.stringify(entries)).toContain('unsupported_input'));
      expect(JSON.stringify(entries)).not.toContain('private-upload-marker');
    } finally {
      await runtime.dispose();
    }
  });

  it('holds storage admission until an open body closes and interrupts stalled bodies', async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      response.write(Buffer.from([4]));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing port');
    const runtime = ManagedRuntime.make(
      s3AssetsLayer({
        endpoint: `http://127.0.0.1:${address.port}`,
        region: 'us-east-1',
        accessKeyId: 'key',
        secretAccessKey: 'secret',
        bucket: 'assets',
        readTimeoutMs: 200,
        maxConcurrentReads: 1,
      })
    );
    const read = Effect.flatMap(AssetReader, (reader) =>
      reader.read({ storageBucket: 'assets', storageKey: 'stalled' })
    );
    try {
      const body = await runtime.runPromise(read);
      if (!body) throw new Error('expected stream');
      await expect(runtime.runPromise(read)).rejects.toMatchObject({
        operation: 'storage_capacity',
      });
      await expect(bytes(body)).rejects.toThrow('Storage read interrupted');
      const second = await runtime.runPromise(read);
      expect(second).not.toBeNull();
      second?.close();
    } finally {
      await runtime.dispose();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('aborts storage requests that stall before response headers', async () => {
    const server = createServer(() => {});
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing port');
    const runtime = ManagedRuntime.make(
      s3AssetsLayer({
        endpoint: `http://127.0.0.1:${address.port}`,
        region: 'us-east-1',
        accessKeyId: 'key',
        secretAccessKey: 'secret',
        bucket: 'assets',
        readTimeoutMs: 50,
      })
    );
    try {
      await expect(
        runtime.runPromise(
          Effect.flatMap(AssetReader, (reader) =>
            reader.read({ storageBucket: 'assets', storageKey: 'stalled' })
          ).pipe(Effect.timeout('1 second'))
        )
      ).rejects.toMatchObject({ _tag: 'DeliveryUnavailable', operation: 'read_asset' });
    } finally {
      await runtime.dispose();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

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
        yield new Uint8Array();
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
