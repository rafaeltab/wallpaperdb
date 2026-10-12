import { Blob as NativeBlob } from 'node:buffer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { openPictureSource } from '@/features/picture-editor/adapters/browser';

beforeEach(() => vi.stubGlobal('Blob', NativeBlob));
afterEach(() => vi.unstubAllGlobals());

// Only headers are relevant to admission. The controlled decoder never allocates these pixels.
function png(width: number, height: number) {
  const bytes = Buffer.alloc(45);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  bytes.writeUInt32BE(13, 8);
  bytes.write('IHDR', 12);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  bytes.write('IEND', 37);
  return new Blob([bytes]);
}

function jpeg(width: number, height: number, progressive = false) {
  const bytes = Buffer.from([255, 216, 255, 225, 0, 4, 0, 0, 255, progressive ? 194 : 192, 0, 11, 8, 0, 0, 0, 0, 1, 1, 17, 0, 255, 217]);
  bytes.writeUInt16BE(height, 13);
  bytes.writeUInt16BE(width, 15);
  return new Blob([bytes]);
}

function webp(width: number, height: number, format: 'VP8 ' | 'VP8L' | 'VP8X') {
  const chunks: Buffer<ArrayBuffer>[] = [];
  if (format === 'VP8X') {
    const extended = Buffer.alloc(18);
    extended.write('VP8X'); extended.writeUInt32LE(10, 4);
    extended.writeUIntLE(width - 1, 12, 3); extended.writeUIntLE(height - 1, 15, 3);
    chunks.push(extended);
  }
  if (format === 'VP8 ') {
    const lossy = Buffer.alloc(18);
    lossy.write('VP8 '); lossy.writeUInt32LE(10, 4);
    lossy.set([157, 1, 42], 11);
    lossy.writeUInt16LE(width, 14); lossy.writeUInt16LE(height, 16);
    chunks.push(lossy);
  } else {
    const lossless = Buffer.alloc(14);
    lossless.write('VP8L'); lossless.writeUInt32LE(5, 4); lossless[8] = 47;
    lossless.writeUInt32LE((width - 1) + (height - 1) * 16384, 9);
    chunks.push(lossless);
  }
  const header = Buffer.alloc(12);
  header.write('RIFF'); header.writeUInt32LE(4 + chunks.reduce((size, chunk) => size + chunk.length, 0), 4); header.write('WEBP', 8);
  return new Blob([header, ...chunks]);
}

const formats = [
  { name: 'PNG', source: png },
  { name: 'JPEG', source: jpeg },
  { name: 'progressive JPEG', source: (width: number, height: number) => jpeg(width, height, true) },
  { name: 'lossy WebP', source: (width: number, height: number) => webp(width, height, 'VP8 ') },
  { name: 'lossless WebP', source: (width: number, height: number) => webp(width, height, 'VP8L') },
  { name: 'extended WebP', source: (width: number, height: number) => webp(width, height, 'VP8X') },
];

it.each(formats)('rejects $name over Ingestor’s 100MP limit before decoding', async ({ source }) => {
  const decode = vi.fn(() => { throw new Error('Source reached the decoder.'); });
  vi.stubGlobal('createImageBitmap', decode);
  vi.stubGlobal('Worker', undefined);
  await expect(openPictureSource(source(10001, 10000), new AbortController().signal)).rejects.toThrow('100 million pixels');
  expect(decode).not.toHaveBeenCalled();
});

it.each([
  { name: 'PNG width', source: png(20001, 1) },
  { name: 'PNG height', source: png(1, 20001) },
  { name: 'JPEG width', source: jpeg(20001, 1) },
  { name: 'JPEG height', source: jpeg(1, 20001) },
  { name: 'WebP canvas width', source: webp(20001, 1, 'VP8X') },
  { name: 'WebP canvas height', source: webp(1, 20001, 'VP8X') },
])('rejects $name over Ingestor’s axis limit before starting a worker', async ({ source }) => {
  const worker = vi.fn(function () { throw new Error('Source reached the worker.'); });
  vi.stubGlobal('Worker', worker);
  vi.stubGlobal('OffscreenCanvas', vi.fn());
  await expect(openPictureSource(source, new AbortController().signal)).rejects.toThrow('20,000 pixels per side');
  expect(worker).not.toHaveBeenCalled();
});

it.each(formats)('accepts $name at Ingestor’s 100MP boundary', async ({ source }) => {
  vi.stubGlobal('OffscreenCanvas', vi.fn());
  vi.stubGlobal('Worker', class {
    onmessage: ((event: MessageEvent) => void) | null = null;
    terminate() {}
    postMessage() {
      queueMicrotask(() => this.onmessage?.(new MessageEvent('message', { data: { ok: true, blob: new Blob(['preview']), width: 10000, height: 10000 } })));
    }
  });
  const result = await openPictureSource(source(10000, 10000), new AbortController().signal);
  expect(result).toMatchObject({ width: 10000, height: 10000 });
  result.dispose();
});

it.each([png, jpeg])('accepts Ingestor’s exact 20,000-pixel axis boundary', async (source) => {
  vi.stubGlobal('OffscreenCanvas', vi.fn());
  vi.stubGlobal('Worker', class {
    onmessage: ((event: MessageEvent) => void) | null = null;
    terminate() {}
    postMessage() {
      queueMicrotask(() => this.onmessage?.(new MessageEvent('message', { data: { ok: true, blob: new Blob(['preview']), width: 20000, height: 1 } })));
    }
  });
  const result = await openPictureSource(source(20000, 1), new AbortController().signal);
  expect(result).toMatchObject({ width: 20000, height: 1 });
  result.dispose();
});

it('checks the WebP bitstream dimensions even when the extended canvas declares a small image', async () => {
  const bytes = new Uint8Array(await webp(10001, 10000, 'VP8X').arrayBuffer());
  bytes.fill(0, 24, 30);
  await expect(openPictureSource(new Blob([bytes]), new AbortController().signal)).rejects.toThrow('100 million pixels');
});

it.each([new Blob([new Uint8Array([255, 216, 255, 192, 0, 30])]), png(0, 10)])('rejects missing or invalid dimensions before decoding', async (source) => {
  const decode = vi.fn();
  vi.stubGlobal('createImageBitmap', decode);
  await expect(openPictureSource(source, new AbortController().signal)).rejects.toThrow('valid dimensions');
  expect(decode).not.toHaveBeenCalled();
});
