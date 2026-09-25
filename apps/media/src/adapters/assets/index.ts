import { Readable, PassThrough } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Effect, Layer } from 'effect';
import sharp from 'sharp';
import { DeliveryUnavailable, ImageTransformer, PictureAuthority } from '../../delivery/index.js';

export const sharpTransformerLayer = (limits: { maxInputPixels: number }) => Layer.succeed(ImageTransformer, ImageTransformer.of({
  resize: (body, options) => Effect.sync(() => {
    const input = Readable.from(body);
    const transformer = sharp({ limitInputPixels: limits.maxInputPixels, sequentialRead: true, failOn: 'none' });
    transformer.resize(options.width, options.height, {
      fit: options.fit === 'contain' ? 'inside' : options.fit,
      withoutEnlargement: options.fit !== 'fill',
      ...(options.fit === 'cover' ? { position: sharp.strategy.entropy } : {}),
    });
    if (options.mimeType === 'image/jpeg') transformer.jpeg({ quality: 90, progressive: true });
    else if (options.mimeType === 'image/png') transformer.png({ compressionLevel: 6 });
    else if (options.mimeType === 'image/webp') transformer.webp({ quality: 90 });
    const output = new PassThrough();
    output.on('error', () => {});
    void pipeline(input, transformer, output).catch(() => {});
    return byteStream(output);
  }),
}));

/** Closing before the first read must release the already acquired socket/pipeline, too. */
function byteStream(stream: Readable): AsyncIterable<Uint8Array> {
  return {
    [Symbol.asyncIterator]() {
      const iterator = stream[Symbol.asyncIterator]();
      return {
        async next() {
          const item = await iterator.next();
          if (item.done) return { done: true, value: undefined };
          if (!(item.value instanceof Uint8Array)) { stream.destroy(); throw new Error('Invalid byte stream'); }
          return { done: false, value: item.value };
        },
        async return() { stream.destroy(); return { done: true, value: undefined }; },
      };
    },
  };
}

export const pictureAuthorityLayer = (config: { origin?: string; token?: string; timeoutMs?: number }) => Layer.succeed(PictureAuthority, PictureAuthority.of({
  isAvailable: (id) => Effect.tryPromise({
    try: async signal => {
      if (!config.origin || !config.token) throw new Error('Picture authority is not configured');
      const response = await fetch(`${config.origin.replace(/\/+$/, '')}/internal/profile-pictures/${encodeURIComponent(id)}/availability`, {
        headers: { Authorization: `Bearer ${config.token}`, 'Cache-Control': 'no-store' },
        redirect: 'error',
        signal: AbortSignal.any([signal, AbortSignal.timeout(config.timeoutMs ?? 3000)]),
      });
      await response.body?.cancel();
      if (response.status === 404) return false;
      if (response.status !== 204) throw new Error('Picture availability could not be verified');
      return true;
    },
    catch: cause => new DeliveryUnavailable({ operation: 'picture_authority', cause }),
  }),
}));
