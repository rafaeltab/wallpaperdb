import { Blob as NativeBlob } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { openPictureSource } from '@/features/picture-editor/adapters/browser';

let jpeg: Buffer<ArrayBuffer>;
const decode = vi.fn(() => { throw new Error('Source reached the decoder.'); });
const worker = vi.fn(function () { throw new Error('Source reached the worker.'); });
beforeEach(async () => {
  vi.stubGlobal('Blob', NativeBlob);
  jpeg = await readFile(new URL('../fixtures/profile-jpeg-colors/profile-sdr.jpg', import.meta.url));
  decode.mockClear(); worker.mockClear();
  vi.stubGlobal('createImageBitmap', decode);
  vi.stubGlobal('Worker', worker);
  vi.stubGlobal('OffscreenCanvas', class {});
});
afterEach(() => vi.unstubAllGlobals());

function app(marker: number, payload: string | Buffer) {
  const bytes = typeof payload === 'string' ? Buffer.from(payload) : payload;
  const header = Buffer.from([255, marker, 0, 0]);
  header.writeUInt16BE(bytes.length + 2, 2);
  return Buffer.concat([header, bytes]);
}

const declarations = [
  { name: 'Adobe XMP', marker: 225, payload: 'http://ns.adobe.com/xap/1.0/\0<x:xmpmeta xmlns:hdrgm="http://ns.adobe.com/hdr-gain-map/1.0/" hdrgm:Version="1.0"/>' },
  { name: 'Apple XMP', marker: 225, payload: "http://ns.adobe.com/xap/1.0/\0<x:xmpmeta xmlns:appl='urn:com:apple:photo:2020:aux:hdrgainmap'/>" },
  { name: 'extended XMP', marker: 225, payload: 'http://ns.adobe.com/xmp/extension/\0<x:xmpmeta xmlns:g="http://ns.adobe.com/hdr-gain-map/1.0/"/>' },
  { name: 'MPF', marker: 226, payload: 'MPF\0' },
  { name: 'ISO', marker: 226, payload: 'urn:iso:std:iso:ts:21496:-1\0' },
];

it.each(['old', 'new'])('rejects the real Apple %s gain-map fixture before decoding', async (version) => {
  const bytes = await readFile(new URL(`../fixtures/profile-jpeg-colors/apple_gainmap_${version}.jpg`, import.meta.url));
  await expect(openPictureSource(new Blob([bytes]), new AbortController().signal)).rejects.toThrow('color interpretation is not supported');
  expect(decode).not.toHaveBeenCalled(); expect(worker).not.toHaveBeenCalled();
});

it.each(declarations)('rejects $name gain-map declarations before rasterization', async ({ marker, payload }) => {
  const bytes = Buffer.concat([jpeg.subarray(0, 2), app(marker, payload), jpeg.subarray(2)]);
  await expect(openPictureSource(new Blob([bytes]), new AbortController().signal)).rejects.toThrow('color interpretation is not supported');
  expect(decode).not.toHaveBeenCalled(); expect(worker).not.toHaveBeenCalled();
});

it('inspects declarations after JPEG dimension headers', async () => {
  const scan = jpeg.indexOf(Buffer.from([255, 218]));
  expect(scan).toBeGreaterThan(0);
  const declaration = declarations[0];
  const bytes = Buffer.concat([jpeg.subarray(0, scan), app(declaration.marker, declaration.payload), jpeg.subarray(scan)]);
  await expect(openPictureSource(new Blob([bytes]), new AbortController().signal)).rejects.toThrow('color interpretation is not supported');
  expect(decode).not.toHaveBeenCalled();
});

it('inspects declarations following entropy-coded scan data', async () => {
  const declaration = declarations[0];
  const bytes = Buffer.concat([jpeg.subarray(0, -2), app(declaration.marker, declaration.payload), jpeg.subarray(-2)]);
  await expect(openPictureSource(new Blob([bytes]), new AbortController().signal)).rejects.toThrow('color interpretation is not supported');
  expect(decode).not.toHaveBeenCalled();
});

it('preserves SDR admission when XMP describes a gain-map namespace without declaring it', async () => {
  const payload = 'http://ns.adobe.com/xap/1.0/\0<x:xmpmeta xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:description>http://ns.adobe.com/hdr-gain-map/1.0/</dc:description></x:xmpmeta>';
  const bytes = Buffer.concat([jpeg.subarray(0, 2), app(225, payload), jpeg.subarray(2)]);
  vi.stubGlobal('Worker', class {
    onmessage: ((event: MessageEvent) => void) | null = null;
    postMessage() { queueMicrotask(() => this.onmessage?.(new MessageEvent('message', { data: { ok: true, blob: new Blob(['preview']), width: 800, height: 400 } }))); }
    terminate() {}
  });
  const source = await openPictureSource(new Blob([bytes]), new AbortController().signal);
  expect(source).toMatchObject({ width: 800, height: 400 });
  source.dispose();
});

it('finds declarations across large APP segments without reading the complete source', async () => {
  const declaration = declarations[0];
  const payload = Buffer.concat([Buffer.from('http://ns.adobe.com/xap/1.0/\0'), Buffer.alloc(64000, 32), Buffer.from('<x:xmpmeta xmlns:g="http://ns.adobe.com/hdr-gain-map/1.0/"/>')]);
  const bytes = Buffer.concat([jpeg.subarray(0, 2), app(224, Buffer.alloc(60000)), app(declaration.marker, payload), jpeg.subarray(2)]);
  const reads: number[] = [];
  class TrackedBlob extends Blob {
    slice(start = 0, end = this.size, type = '') {
      reads.push(end - start);
      return super.slice(start, end, type);
    }
  }
  await expect(openPictureSource(new TrackedBlob([bytes]), new AbortController().signal)).rejects.toThrow('color interpretation is not supported');
  expect(Math.max(...reads)).toBeLessThanOrEqual(65536);
  expect(decode).not.toHaveBeenCalled();
});

it('honors cancellation during JPEG color inspection before decoding', async () => {
  const controller = new AbortController();
  class CancelledBlob extends Blob {
    slice(start = 0, end = this.size, type = '') {
      if (end - start === 65536) controller.abort();
      return super.slice(start, end, type);
    }
  }
  await expect(openPictureSource(new CancelledBlob([jpeg]), controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  expect(decode).not.toHaveBeenCalled();
  expect(worker).not.toHaveBeenCalled();
});
