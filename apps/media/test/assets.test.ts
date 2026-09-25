import { createServer } from 'node:http';
import { Effect, Layer } from 'effect';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { ImageTransformer, PictureAuthority } from '../src/delivery/index.js';
import { pictureAuthorityLayer, sharpTransformerLayer } from '../src/adapters/assets/index.js';

async function bytes(body: AsyncIterable<Uint8Array>) { const chunks = []; for await (const chunk of body) chunks.push(chunk); return Buffer.concat(chunks); }
async function* stream(value: Uint8Array) { yield value; }

describe('production asset adapters', () => {
  it('uses authoritative availability and fails closed for unexpected responses', async () => {
    let status = 204;
    const seen: string[] = [];
    const server = createServer((req,res) => { seen.push(req.headers.authorization ?? ''); res.writeHead(status).end(); });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address(); if (!address || typeof address === 'string') throw new Error('missing port');
      const layer = pictureAuthorityLayer({ origin: `http://127.0.0.1:${address.port}`, token: 'private-token', timeoutMs: 1000 });
      const check = Effect.flatMap(PictureAuthority, a => a.isAvailable('pic_1')).pipe(Effect.provide(layer));
      expect(await Effect.runPromise(check)).toBe(true);
      status = 404; expect(await Effect.runPromise(check)).toBe(false);
      status = 500; await expect(Effect.runPromise(check)).rejects.toMatchObject({ _tag: 'DeliveryUnavailable' });
      expect(seen).toEqual(['Bearer private-token', 'Bearer private-token', 'Bearer private-token']);
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  });
  it('resizes actual image bytes without enlarging contain images', async () => {
    const input = await sharp({ create: { width: 80, height: 40, channels: 3, background: 'red' } }).png().toBuffer();
    const output = await Effect.runPromise(Effect.flatMap(ImageTransformer, t => t.resize(stream(input), { width: 160, height: 100, fit: 'contain', mimeType: 'image/png' })).pipe(Effect.provide(sharpTransformerLayer({ maxInputPixels: 100000 }))));
    expect(await sharp(await bytes(output)).metadata()).toMatchObject({ width: 80, height: 40, format: 'png' });
  });
});
