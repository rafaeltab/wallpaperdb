import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { createDefaultTesterBuilder, DockerTesterBuilder, S3TesterBuilder, NatsTesterBuilder } from '@wallpaperdb/test-utils';
import { Effect, Layer, ManagedRuntime, Result } from 'effect';
import sharp from 'sharp';
import { beforeAll, afterAll, expect, it } from 'vitest';
import { imageLayer } from '../src/adapters/image/index.js';
import { natsEventsLayer } from '../src/adapters/events/index.js';
import { VariantImages, VariantEvents, type GenerationInput } from '../src/generation/index.js';

const Tester = createDefaultTesterBuilder().with(DockerTesterBuilder).with(S3TesterBuilder).with(NatsTesterBuilder).build();
const tester = new Tester().withS3().withS3Bucket('wallpapers').withNats((nats) => nats.withJetstream()).withStream('WALLPAPER');
let sourceFingerprint = '';
const preset = { width: 80, height: 45, label: 'small' };
function input(id: string): GenerationInput {
  return { wallpaperId: id, fileType: 'image', mimeType: 'image/jpeg', width: 160, height: 100,
    storage: { bucket: 'wallpapers', key: 'original.jpg' }, occurrence: { source: 'test', id }, timestamp: '2026-01-01T00:00:00.000Z' };
}
function runtime(quality: number) {
  const s3 = tester.getS3();
  return ManagedRuntime.make(Layer.mergeAll(imageLayer({ endpoint: s3.endpoints.fromHost, region: 'us-east-1',
    accessKeyId: s3.options.accessKey, secretAccessKey: s3.options.secretKey, bucket: 'wallpapers',
    jpegQuality: quality, webpQuality: 90, pngCompressionLevel: 6 }), natsEventsLayer({
      url: tester.nats.config.endpoints.fromHost, stream: 'WALLPAPER', serviceName: `image-replay-${quality}`,
    })));
}
const generate = (value: GenerationInput) => Effect.flatMap(VariantImages, (images) => images.generate(value, preset));
async function stored(id: string) {
  const object = await tester.s3.getS3Client().send(new GetObjectCommand({ Bucket: 'wallpapers', Key: `${id}/variant_80x45.jpg` }));
  return { bytes: await object.Body?.transformToByteArray(), metadata: object.Metadata };
}
beforeAll(async () => {
  await tester.setup();
  const pixels = Buffer.from(Array.from({ length: 160 * 100 * 3 }, (_, i) => (i * 73 + Math.floor(i / 17)) % 256));
  const original = await sharp(pixels, { raw: { width: 160, height: 100, channels: 3 } }).jpeg({ quality: 100 }).toBuffer();
  await tester.s3.uploadObject('wallpapers', 'original.jpg', original);
  const app = runtime(90);
  try {
    await app.runPromise(generate(input('metadata-template')));
    const source = (await stored('metadata-template')).metadata?.['variant-source'];
    if (source === undefined) throw new Error('Missing source fingerprint on new variant');
    sourceFingerprint = source;
  } finally { await app.dispose(); }
});
afterAll(() => tester.destroy());

it('keeps stored bytes and the deduplicated announcement consistent when quality changes on retry', async () => {
  const high = runtime(90); const low = runtime(20);
  const value = input('quality-replay');
  const publish = Effect.gen(function* () {
    const variant = yield* generate(value);
    yield* (yield* VariantEvents).publish({ input: value, variant });
    return variant;
  });
  try {
    const first = await high.runPromise(publish);
    const original = await stored(value.wallpaperId);
    const second = await low.runPromise(publish);
    expect(second).toEqual(first);
    expect((await stored(value.wallpaperId)).bytes).toEqual(original.bytes);
    const manager = await (await tester.nats.getConnection()).jetstreamManager();
    expect((await manager.streams.info('WALLPAPER')).state.messages).toBe(1);
    const event = (await manager.streams.getMessage('WALLPAPER', { last_by_subj: 'wallpaper.variant.uploaded' })).json();
    expect(event).toMatchObject({ variant: { fileSizeBytes: original.bytes?.byteLength, createdAt: first.createdAt.toISOString() } });
  } finally { await high.dispose(); await low.dispose(); }
});

it('atomically preserves the first target across concurrent qualities and distinct occurrences', async () => {
  const high = runtime(90); const low = runtime(20);
  const value = input('quality-race');
  try {
    const [first, second] = await Promise.all([
      high.runPromise(generate(value)),
      low.runPromise(generate({ ...value, occurrence: { source: 'other-producer', id: 'other-occurrence' }, timestamp: '2026-02-01T00:00:00.000Z' })),
    ]);
    expect(second).toEqual(first);
    expect(first.fileSizeBytes).toBe((await stored(value.wallpaperId)).bytes?.byteLength);
    expect(await high.runPromise(generate(value))).toEqual(first);
    expect(await low.runPromise(generate(value))).toEqual(first);
  } finally { await high.dispose(); await low.dispose(); }
});

it('adopts a legacy target read-only and preserves the input timestamp fallback', async () => {
  const app = runtime(90); const value = input('legacy-target');
  const legacy = await sharp({ create: { width: 72, height: 45, channels: 3, background: '#f00' } }).jpeg().toBuffer();
  await tester.s3.getS3Client().send(new PutObjectCommand({ Bucket: 'wallpapers', Key: `${value.wallpaperId}/variant_80x45.jpg`, Body: legacy, ContentType: 'image/jpeg' }));
  try {
    const variant = await app.runPromise(generate(value));
    expect(variant.fileSizeBytes).toBe(legacy.length);
    expect(variant.createdAt).toEqual(new Date(value.timestamp));
    expect((await stored(value.wallpaperId)).bytes).toEqual(new Uint8Array(legacy));
    expect((await stored(value.wallpaperId)).metadata).toEqual({});
  } finally { await app.dispose(); }
});

it('rejects a target collision with a different immutable original without overwriting', async () => {
  const app = runtime(90); const value = input('source-collision');
  try {
    await app.runPromise(generate(value));
    const first = await stored(value.wallpaperId);
    const other = await sharp({ create: { width: 160, height: 100, channels: 3, background: '#00f' } }).jpeg().toBuffer();
    await tester.s3.uploadObject('wallpapers', 'other-original.jpg', other);
    const result = await app.runPromise(Effect.result(generate({ ...value, storage: { bucket: 'wallpapers', key: 'other-original.jpg' } })));
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) expect(result.failure).toMatchObject({ _tag: 'GenerationUnavailable', operation: 'write-image' });
    expect(await stored(value.wallpaperId)).toEqual(first);
  } finally { await app.dispose(); }
});

const invalidTargets: readonly { name: string; metadata: Record<string, string>; contentType: string; empty: boolean }[] = [
  { name: 'partial-source', metadata: { 'variant-source': 'invalid' }, contentType: 'image/jpeg', empty: false },
  { name: 'partial-created', metadata: { 'variant-created-at': '2026-01-01T00:00:00.000Z' }, contentType: 'image/jpeg', empty: false },
  { name: 'invalid-created', metadata: { 'variant-source': 'replace-with-valid-source', 'variant-created-at': 'invalid' }, contentType: 'image/jpeg', empty: false },
  { name: 'wrong-mime', metadata: {}, contentType: 'image/png', empty: false },
  { name: 'empty', metadata: {}, contentType: 'image/jpeg', empty: true },
];
it.each(invalidTargets)('rejects incompatible stored target $name without overwriting it', async ({ name, metadata, contentType, empty }) => {
  const app = runtime(90); const value = input(`invalid-${name}`);
  const body = empty ? Buffer.alloc(0) : await sharp({ create: { width: 72, height: 45, channels: 3, background: '#f00' } }).jpeg().toBuffer();
  await tester.s3.getS3Client().send(new PutObjectCommand({ Bucket: 'wallpapers', Key: `${value.wallpaperId}/variant_80x45.jpg`, Body: body, ContentType: contentType, Metadata: name === 'partial-source' || name === 'invalid-created' ? { ...metadata, 'variant-source': sourceFingerprint } : metadata }));
  try {
    const before = await stored(value.wallpaperId);
    const result = await app.runPromise(Effect.result(generate(value)));
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) expect(result.failure).toMatchObject({ _tag: 'GenerationUnavailable', operation: 'write-image' });
    expect(await stored(value.wallpaperId)).toEqual(before);
  } finally { await app.dispose(); }
});
