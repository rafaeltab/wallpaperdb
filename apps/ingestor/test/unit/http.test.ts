import { afterEach, describe, expect, it } from 'vitest';
import { Effect, Layer } from 'effect';
import type { FastifyInstance } from 'fastify';
import { Admission, type AdmissionResult } from '../../src/admission/index.js';
import { availabilityLayer, AvailabilityProbe } from '../../src/availability/index.js';
import { Ingestion, IngestionUnavailable, type UploadInput, type UploadOutcome } from '../../src/ingestion/index.js';
import { createHttpApp } from '../../src/http/index.js';

const receipt = { id: 'wlpr_test', uploadedAt: '2026-01-01T00:00:00.000Z', fileType: 'image' as const, mimeType: 'image/png', width: 1920, height: 1080, fileSizeBytes: 5 };
const apps: FastifyInstance[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });
async function fixture(outcome: UploadOutcome = { _tag: 'Accepted', upload: receipt }, admission: AdmissionResult = { _tag: 'Allowed', remaining: 9, reset: 1000 }, fail = false) {
  const uploads: UploadInput[] = [];
  const services = Layer.mergeAll(
    Layer.succeed(Ingestion, { upload: (input) => fail ? Effect.fail(new IngestionUnavailable({ operation: 'database', cause: new Error('private-secret') })) : Effect.sync(() => { uploads.push(input); return outcome; }), reconcile: () => Effect.void, cleanup: () => Effect.void }),
    Layer.succeed(Admission, { admit: () => Effect.succeed(admission) }),
    availabilityLayer.pipe(Layer.provide(Layer.succeed(AvailabilityProbe, { inspect: () => Effect.succeed({ database: true, s3: true, nats: true, otel: true }) })))
  );
  const app = await createHttpApp({ nodeEnv: 'test', port: 0, rateLimitMax: 10 }, services);
  apps.push(app);
  return { app, uploads };
}
const authorization = `Bearer ${Buffer.from(JSON.stringify({ id: 'authenticated-profile' })).toString('base64')}`;
function multipart() {
  const boundary = 'test-boundary';
  return { headers: { authorization, 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="test.png"\r\nContent-Type: image/png\r\n\r\nimage\r\n--${boundary}--\r\n`) };
}
describe('upload HTTP contract', () => {
  it('authenticates before admitting or reading uploads, including URL query variants', async () => {
    const { app, uploads } = await fixture();
    const response = await app.inject({ method: 'POST', url: '/upload?source=web', payload: 'invalid body' });
    expect(response.statusCode).toBe(401);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.json().type).toContain('/docs/problems/unauthorized.md');
    expect(uploads).toEqual([]);
  });
});
it('translates multipart bytes and authenticated ownership through the ingestion port', async () => {
  const { app, uploads } = await fixture();
  const response = await app.inject({ method: 'POST', url: '/upload?source=web', ...multipart() });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({ ...receipt, status: 'processing' });
  expect(response.headers['x-ratelimit-remaining']).toBe('9');
  expect(uploads[0]).toMatchObject({ principal: { profileId: 'authenticated-profile' }, filename: 'test.png', declaredMimeType: 'image/png' });
  expect(Buffer.from(uploads[0].bytes).toString()).toBe('image');
});
it.each<{ outcome: UploadOutcome; status: number; type: string }>([
  { outcome: { _tag: 'Duplicate', upload: receipt }, status: 200, type: 'already_uploaded' },
  { outcome: { _tag: 'InProgress' }, status: 409, type: 'upload-in-progress' },
  { outcome: { _tag: 'Unauthorized' }, status: 401, type: 'unauthorized' },
  { outcome: { _tag: 'InvalidFormat', mimeType: 'text/plain' }, status: 400, type: 'invalid-file-format' },
  { outcome: { _tag: 'TooLarge', fileSizeBytes: 10, maxFileSizeBytes: 5, fileType: 'image' }, status: 413, type: 'file-too-large' },
  { outcome: { _tag: 'InvalidDimensions', width: 1, height: 1, minWidth: 1280, minHeight: 720, maxWidth: 7680, maxHeight: 4320 }, status: 400, type: 'dimensions-out-of-bounds' },
])('maps $outcome._tag to a declared HTTP response', async ({ outcome, status, type }) => {
  const { app } = await fixture(outcome);
  const response = await app.inject({ method: 'POST', url: '/upload', ...multipart() });
  expect(response.statusCode).toBe(status);
  if (status === 200) expect(response.json().status).toBe(type);
  else {
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.json()).toMatchObject({ status, type: `https://github.com/rafaeltab/wallpaperdb/blob/main/docs/problems/${type}.md` });
  }
});
it('rejects quota denial with reset headers without reading an upload', async () => {
  const { app, uploads } = await fixture(undefined, { _tag: 'Limited', retryAfter: 3, reset: 3000 });
  const response = await app.inject({ method: 'POST', url: '/upload', ...multipart() });
  expect(response.statusCode).toBe(429);
  expect(response.headers['retry-after']).toBe('3');
  expect(response.headers['x-ratelimit-remaining']).toBe('0');
  expect(response.json().type).toContain('rate-limit-exceeded.md');
  expect(uploads).toEqual([]);
});
it('hides infrastructure diagnostic causes in a typed unavailable response', async () => {
  const { app } = await fixture(undefined, undefined, true);
  const response = await app.inject({ method: 'POST', url: '/upload', ...multipart() });
  expect(response.statusCode).toBe(503);
  expect(response.json().type).toContain('service-unavailable.md');
  expect(response.body).not.toContain('private-secret');
});
