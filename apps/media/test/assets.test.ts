import { createServer } from 'node:http';
import { Effect, Layer } from 'effect';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { ImageTransformer, PictureAuthority } from '../src/delivery/index.js';
import { pictureAuthorityLayer, sharpTransformerLayer } from '../src/adapters/assets/index.js';

async function bytes(body: AsyncIterable<Uint8Array>) { const chunks = []; for await (const chunk of body) chunks.push(chunk); return Buffer.concat(chunks); }
async function* stream(value: Uint8Array) { yield value; }

describe('production asset adapters', () => {
  it('resizes actual image bytes without enlarging contain images', async () => {
    const input = await sharp({ create: { width: 80, height: 40, channels: 3, background: 'red' } }).png().toBuffer();
    const output = await Effect.runPromise(Effect.flatMap(ImageTransformer, t => t.resize(stream(input), { width: 160, height: 100, fit: 'contain', mimeType: 'image/png' })).pipe(Effect.provide(sharpTransformerLayer({ maxInputPixels: 100000 }))));
    expect(await sharp(await bytes(output)).metadata()).toMatchObject({ width: 80, height: 40, format: 'png' });
  });
});
