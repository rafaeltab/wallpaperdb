import { describe, expect, it } from 'vitest';
import { createPictureEditor, type PictureSource } from '@/features/picture-editor';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const policy = {
  acceptedSourceFormats: ['image/png', 'image/gif'],
  output: { width: 512, height: 512, mimeType: 'image/webp' as const, colorSpace: 'srgb' as const },
  maxOutputBytes: 5242880, animation: { available: true },
  encoding: { staticQuality: 85, animationQuality: 85 },
};
const profile = { version: 1, limits: { maxPixels: 20000000, maxDecodedBytes: 80000000 } };

function setup() {
  const decodes: { file: File; signal: AbortSignal; result: ReturnType<typeof deferred<PictureSource>> }[] = [];
  const previews = new Set<string>();
  let previewId = 0;
  const editor = createPictureEditor(profile, {
    openSource(file, signal) {
      const result = deferred<PictureSource>();
      decodes.push({ file, signal, result });
      return result.promise;
    },
    previews: {
      create() {
        const url = `preview:${++previewId}`;
        previews.add(url);
        return url;
      },
      release(url) { previews.delete(url); },
    },
  });
  const deactivate = editor.activate();
  editor.open();
  return { editor, decodes, previews, deactivate };
}

function source() {
  let disposed = false;
  const picture: PictureSource = {
    width: 800, height: 400, preview: new Blob(['preview']),
    process: async () => new Blob(['processed'], { type: 'image/webp' }),
    dispose() { disposed = true; },
  };
  return { picture, isDisposed: () => disposed };
}

describe('picture editing session', () => {
  it('replaces a source immediately, disposes its late decode, and resets the crop', async () => {
    const { editor, decodes, previews } = setup();
    const first = editor.select(new File(['first'], 'first.png', { type: 'image/png' }), policy);
    editor.receiveProfile({ ...profile, version: 2 });
    const second = editor.select(new File(['second'], 'second.png', { type: 'image/png' }), policy);
    expect(decodes[0].signal.aborted).toBe(true);
    const obsolete = source();
    decodes[0].result.resolve(obsolete.picture);
    await first;
    expect(obsolete.isDisposed()).toBe(true);
    expect(previews.size).toBe(0);
    decodes[1].result.resolve(source().picture);
    await second;
    expect(editor.getSnapshot().selection).toMatchObject({
      file: { name: 'second.png' }, expectedVersion: 2,
      crop: { x: 200, y: 0, size: 400, zoom: 1 },
    });
    expect(previews.size).toBe(1);
    editor.close();
    expect(previews.size).toBe(0);
  });
});
