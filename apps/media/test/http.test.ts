import { Effect, Layer } from 'effect';
import { describe, expect, it } from 'vitest';
import { AvailabilityProbe, availabilityLayer } from '../src/availability/index.js';
import { DeliveryUnavailable, MediaDelivery, type ResizeOptions } from '../src/delivery/index.js';
import { createHttpApp } from '../src/http/index.js';

const health = availabilityLayer.pipe(Layer.provide(Layer.succeed(AvailabilityProbe, {
  inspect: () => Effect.succeed({ database: true, s3: true, nats: true, consumer: true, otel: true }),
})));
const empty = { wallpaper: () => Effect.succeed({ _tag: 'NotFound' } as const), picture: () => Effect.succeed({ _tag: 'NotFound' } as const) };
const services = (delivery: MediaDelivery = empty) => Layer.merge(health, Layer.succeed(MediaDelivery, delivery));

describe('Media HTTP contract', () => {
  it('translates wallpaper query and streams exact original bytes with immutable headers', async () => {
    const calls: Array<{id: string; options?: ResizeOptions}> = [];
    const app = await createHttpApp({ nodeEnv: 'test', port: 0 }, services({ ...empty,
      wallpaper: (id, options) => {
        calls.push({ id, options });
        return Effect.succeed({ _tag: 'Found', body: (async function* () { yield new Uint8Array([1, 2, 3]); })(), mimeType: 'image/png', fileSizeBytes: 3 });
      },
    }));
    try {
      const result = await app.inject('/wallpapers/wallpaper_1');
      expect(calls).toEqual([{ id: 'wallpaper_1', options: { fit: 'contain', width: undefined, height: undefined } }]);
      expect(result.statusCode).toBe(200);
      expect(result.rawPayload).toEqual(Buffer.from([1,2,3]));
      expect(result.headers).toMatchObject({ 'content-type': 'image/png', 'content-length': '3', 'cache-control': 'public, max-age=31536000, immutable' });
    } finally { await app.close(); }
  });
});

it.each(['GET', 'HEAD'] as const)('checks Profile authority through the capability for %s and never caches absence', async (method) => {
  const pictures: string[] = [];
  const app = await createHttpApp({ nodeEnv: 'test', port: 0 }, services({ ...empty, picture: id => { pictures.push(id); return Effect.succeed({ _tag: 'NotFound' }); } }));
  try {
    const result = await app.inject({ method, url: '/profile-pictures/pic_1' });
    expect(pictures).toEqual(['pic_1']);
    expect(result.statusCode).toBe(404);
    expect(result.headers['cache-control']).toBe('no-store');
    expect(result.headers['content-type']).toContain('application/problem+json');
  } finally { await app.close(); }
});
it.each(['wallpapers/w1', 'profile-pictures/p1'])('hides technical failures for %s', async path => {
  const fail = () => Effect.fail(new DeliveryUnavailable({ operation: 'storage', cause: new Error('private-storage-key secret-token') }));
  const app = await createHttpApp({ nodeEnv: 'test', port: 0 }, services({ wallpaper: fail, picture: fail }));
  try {
    const result = await app.inject('/' + path);
    expect(result.statusCode).toBe(503);
    expect(result.headers['cache-control']).toBe('no-store');
    expect(result.json().type).toMatch(/^https:\/\/github.com\/rafaeltab\/wallpaperdb\/blob\/main\/docs\/problems\//);
    expect(result.body).not.toContain('private-storage-key');
    expect(result.body).not.toContain('secret-token');
  } finally { await app.close(); }
});
it.each(['w=0', 'w=2.5', 'h=-1', 'fit=outside', 'w=x', 'w=1&w=2'])('rejects malformed query %s before invoking delivery', async query => {
  const app = await createHttpApp({ nodeEnv: 'test', port: 0 }, services({ ...empty, wallpaper: () => Effect.die('must not call') }));
  try {
    const result = await app.inject('/wallpapers/w1?' + query);
    expect(result.statusCode).toBe(400);
    expect(result.json().type).toContain('/invalid-dimensions.md');
  } finally { await app.close(); }
});
it('translates capability rejection and hides defects', async () => {
  const app = await createHttpApp({ nodeEnv: 'test', port: 0 }, services({ wallpaper: () => Effect.succeed({ _tag: 'Rejected', reason: 'Width exceeds configured limit' }), picture: () => Effect.die(new Error('private programmer detail')) }));
  try {
    const rejected = await app.inject('/wallpapers/w1?w=9000');
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json().detail).toBe('Width exceeds configured limit');
    const defect = await app.inject('/profile-pictures/p1');
    expect(defect.statusCode).toBe(500);
    expect(defect.json().type).toContain('/generic-server.md');
    expect(defect.body).not.toContain('private programmer detail');
  } finally { await app.close(); }
});
