import { describe, expect, it } from 'vitest';
import { createPictureEditor, type PictureSource, type PictureCommand, type PictureSaveResult, type PictureCrop } from '@/features/picture-editor';

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
  let busy = false;
  const availabilityListeners = new Set<() => void>();
  const requests: { command: PictureCommand; result: ReturnType<typeof deferred<PictureSaveResult>> }[] = [];
  const notices: string[] = [];
  const refreshes: ReturnType<typeof deferred<{ version: number }>>[] = [];
  let owner = {};
  const ownerListeners = new Set<() => void>();
  function setBusy(next: boolean, notify = true) {
    busy = next;
    if (notify) for (const listener of availabilityListeners) listener();
  }
  const editor = createPictureEditor(profile, {
    ownership: {
      getIdentity: () => owner,
      subscribe(listener) { ownerListeners.add(listener); return () => { ownerListeners.delete(listener); }; },
    },
    availability: {
      isBusy: () => busy,
      subscribe(listener) { availabilityListeners.add(listener); return () => { availabilityListeners.delete(listener); }; },
    },
    save(command) {
      if (busy) throw new Error('Profile is busy');
      setBusy(true);
      const result = deferred<PictureSaveResult>();
      requests.push({ command, result });
      return result.promise.finally(() => setBusy(false));
    },
    notify(message) { notices.push(message); },
    refresh() {
      if (busy) throw new Error('Profile is busy');
      setBusy(true);
      const result = deferred<{ version: number }>();
      refreshes.push(result);
      return result.promise.finally(() => setBusy(false));
    },
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
  return { editor, decodes, previews, deactivate, requests, notices, setBusy, availabilityListeners, refreshes, ownerListeners,
    replaceOwner(notify = true) { owner = {}; if (notify) for (const listener of ownerListeners) listener(); },
  };
}

function source() {
  let disposed = false;
  const encodes: { crop: PictureCrop; signal: AbortSignal; result: ReturnType<typeof deferred<Blob>> }[] = [];
  const picture: PictureSource = {
    width: 800, height: 400, preview: new Blob(['preview']),
    process(crop, _policy, signal) {
      const result = deferred<Blob>();
      encodes.push({ crop, signal, result });
      return result.promise;
    },
    dispose() { disposed = true; },
  };
  return { picture, encodes, isDisposed: () => disposed };
}

async function selectReady(context: ReturnType<typeof setup>) {
  const selected = context.editor.select(new File(['source'], 'portrait.png', { type: 'image/png' }), policy);
  const decoded = source();
  context.decodes.at(-1)!.result.resolve(decoded.picture);
  await selected;
  return decoded;
}

const canonical = new Blob(['processed'], { type: 'image/webp' });

describe('picture editing session', () => {
  it('captures the removal confirmation version independently of upload policy and keeps cancellation local', async () => {
    const { editor, requests, notices } = setup();
    editor.requestRemoval();
    editor.cancelRemoval();
    await editor.confirmRemoval();
    expect(requests).toEqual([]);
    editor.requestRemoval();
    editor.receiveProfile({ ...profile, version: 5 });
    const removing = editor.confirmRemoval();
    expect(requests[0].command).toEqual({ action: 'remove', expectedVersion: 1 });
    requests[0].result.resolve({ success: true });
    await removing;
    expect(editor.getSnapshot()).toMatchObject({ open: false, removeVersion: null });
    expect(notices).toEqual(['Generated avatar selected']);
  });
  it('fences local work when the owner query is replaced and releases its subscription on deactivation', async () => {
    const context = setup();
    const decoded = await selectReady(context);
    const applying = context.editor.apply(policy);
    context.replaceOwner();
    expect(context.editor.getSnapshot()).toMatchObject({ open: false, selection: null });
    expect(decoded.encodes[0].signal.aborted).toBe(true);
    expect(decoded.isDisposed()).toBe(true);
    expect(context.previews.size).toBe(0);
    decoded.encodes[0].result.resolve(canonical);
    await applying;
    expect(context.requests).toEqual([]);
    context.deactivate();
    expect(context.ownerListeners.size).toBe(0);
  });
  it('preserves the crop on conflict, refreshes the saved Profile, and requires an explicit retry', async () => {
    const context = setup();
    const decoded = await selectReady(context);
    const crop = { x: 300, y: 100, size: 200, zoom: 2, maxZoom: 6.25, lowResolution: false };
    context.editor.setCrop(crop);
    const applying = context.editor.apply(policy);
    decoded.encodes[0].result.resolve(canonical);
    await expect.poll(() => context.requests.length).toBe(1);
    context.requests[0].result.resolve({ success: false, error: { message: 'Conflict', versionConflict: true } });
    await expect.poll(() => context.refreshes.length).toBe(1);
    expect(context.editor.getSnapshot()).toMatchObject({ recovery: 'required', selection: { crop, expectedVersion: null } });
    context.refreshes[0].resolve({ version: 7 });
    await applying;
    expect(context.editor.getSnapshot()).toMatchObject({ recovery: 'review', selection: { crop, expectedVersion: 7 } });
    expect(context.requests).toHaveLength(1);
    const retrying = context.editor.apply(policy);
    expect(decoded.encodes[1].crop).toEqual(crop);
    decoded.encodes[1].result.resolve(canonical);
    await expect.poll(() => context.requests.length).toBe(2);
    expect(context.requests[1].command.expectedVersion).toBe(7);
    context.requests[1].result.resolve({ success: true });
    await retrying;
  });
  it('uploads processed bytes with the captured version and releases the edit after success', async () => {
    const context = setup();
    const decoded = await selectReady(context);
    context.editor.receiveProfile({ ...profile, version: 8 });
    const applying = context.editor.apply(policy);
    decoded.encodes[0].result.resolve(canonical);
    await expect.poll(() => context.requests.length).toBe(1);
    expect(context.requests[0].command).toMatchObject({ action: 'upload', expectedVersion: 1, picture: { name: 'profile-picture.webp', type: 'image/webp', size: 9 } });
    context.requests[0].result.resolve({ success: true });
    await applying;
    expect(context.editor.getSnapshot()).toMatchObject({ open: false, selection: null, processing: false, error: null });
    expect(context.previews.size).toBe(0);
    expect(decoded.isDisposed()).toBe(true);
    expect(context.notices).toEqual(['Profile picture saved']);
  });
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
