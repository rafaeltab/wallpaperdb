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

describe('picture workflow recovery and lifetimes', () => {
  it('retains a failed decode for retry and releases a cancelled late decode', async () => {
    const context = setup();
    const file = new File(['source'], 'portrait.png', { type: 'image/png' });
    const selecting = context.editor.select(file, policy);
    context.decodes[0].result.reject(new Error('Decode failed'));
    await selecting;
    expect(context.editor.getSnapshot()).toMatchObject({ error: 'Decode failed', selection: { file, source: null }, processing: false });
    const applying = context.editor.apply(policy);
    context.editor.cancel();
    const obsolete = source();
    context.decodes[1].result.resolve(obsolete.picture);
    await applying;
    expect(obsolete.isDisposed()).toBe(true);
    const retrying = context.editor.apply(policy);
    const decoded = source();
    context.decodes[2].result.resolve(decoded.picture);
    await expect.poll(() => decoded.encodes.length).toBe(1);
    decoded.encodes[0].result.resolve(canonical);
    await expect.poll(() => context.requests.length).toBe(1);
    context.requests[0].result.resolve({ success: true });
    await retrying;
  });

  it.each(['png', 'gif'])('cancels %s processing, ignores its late result, and retries the retained crop', async (format) => {
    const context = setup();
    const selecting = context.editor.select(new File(['source'], `portrait.${format}`, { type: `image/${format}` }), policy);
    const decoded = source();
    context.decodes[0].result.resolve(decoded.picture);
    await selecting;
    const crop = { x: 300, y: 100, size: 200, zoom: 2, maxZoom: 6.25, lowResolution: false };
    context.editor.setCrop(crop);
    const applying = context.editor.apply(policy);
    context.editor.cancel();
    expect(decoded.encodes[0].signal.aborted).toBe(true);
    decoded.encodes[0].result.resolve(canonical);
    await applying;
    expect(context.requests).toEqual([]);
    expect(context.editor.getSnapshot()).toMatchObject({ processing: false, selection: { crop } });
    const retrying = context.editor.apply(policy);
    expect(decoded.encodes[1].crop).toEqual(crop);
    decoded.encodes[1].result.resolve(canonical);
    await expect.poll(() => context.requests.length).toBe(1);
    context.requests[0].result.resolve({ success: true });
    await retrying;
  });

  it('keeps processing and upload failures editable, and retries the current crop with the captured version', async () => {
    const context = setup();
    const decoded = await selectReady(context);
    let applying = context.editor.apply(policy);
    decoded.encodes[0].result.reject(new Error('Encoding failed'));
    await applying;
    expect(context.editor.getSnapshot()).toMatchObject({ error: 'Encoding failed', selection: { file: { name: 'portrait.png' } } });
    applying = context.editor.apply(policy);
    decoded.encodes[1].result.resolve(canonical);
    await expect.poll(() => context.requests.length).toBe(1);
    context.requests[0].result.resolve({ success: false, error: { message: 'Upload unavailable' } });
    await applying;
    expect(context.editor.getSnapshot().error).toBe('Upload unavailable');
    const crop = { x: 350, y: 150, size: 100, zoom: 4, maxZoom: 6.25, lowResolution: false };
    context.editor.setCrop(crop);
    context.editor.receiveProfile({ ...profile, version: 8 });
    applying = context.editor.apply(policy);
    expect(decoded.encodes[2].crop).toEqual(crop);
    decoded.encodes[2].result.resolve(canonical);
    await expect.poll(() => context.requests.length).toBe(2);
    expect(context.requests[1].command.expectedVersion).toBe(1);
    context.requests[1].result.resolve({ success: true });
    await applying;
  });

  it('checks live availability before work and again after processing without losing the edit', async () => {
    const context = setup();
    const decoded = await selectReady(context);
    context.setBusy(true, false);
    await context.editor.apply(policy);
    await context.editor.select(new File(['other'], 'other.png', { type: 'image/png' }), policy);
    context.editor.requestRemoval();
    expect(context.decodes).toHaveLength(1);
    expect(decoded.encodes).toEqual([]);
    expect(context.editor.getSnapshot().removeVersion).toBeNull();
    context.setBusy(false);
    const applying = context.editor.apply(policy);
    await context.editor.apply(policy);
    expect(decoded.encodes).toHaveLength(1);
    context.setBusy(true, false);
    decoded.encodes[0].result.resolve(canonical);
    await applying;
    expect(context.requests).toEqual([]);
    expect(context.editor.getSnapshot()).toMatchObject({ processing: false, error: expect.stringContaining('Your Profile is busy'), selection: { file: { name: 'portrait.png' } } });
    context.setBusy(false);
    const retrying = context.editor.apply(policy);
    decoded.encodes[1].result.resolve(canonical);
    await expect.poll(() => context.requests.length).toBe(1);
    context.requests[0].result.resolve({ success: true });
    await retrying;
  });

  it('blocks stale writes after a failed refresh, including after replacing the source, until explicit recovery succeeds', async () => {
    const context = setup();
    const decoded = await selectReady(context);
    const applying = context.editor.apply(policy);
    decoded.encodes[0].result.resolve(canonical);
    await expect.poll(() => context.requests.length).toBe(1);
    context.requests[0].result.resolve({ success: false, error: { message: 'Conflict', versionConflict: true } });
    await expect.poll(() => context.refreshes.length).toBe(1);
    context.refreshes[0].reject(new Error('Offline'));
    await applying;
    expect(context.editor.getSnapshot()).toMatchObject({ recovery: 'required', error: expect.stringContaining('Unable to refresh') });
    const replacement = await selectReady(context);
    await context.editor.apply(policy);
    context.editor.requestRemoval();
    expect(context.requests).toHaveLength(1);
    expect(replacement.encodes).toEqual([]);
    expect(context.editor.getSnapshot().selection?.expectedVersion).toBeNull();
    const refreshing = context.editor.refresh();
    context.refreshes[1].resolve({ version: 9 });
    await refreshing;
    expect(context.requests).toHaveLength(1);
    expect(context.editor.getSnapshot()).toMatchObject({ recovery: 'review', selection: { expectedVersion: 9, crop: { zoom: 1 } } });
    const retrying = context.editor.apply(policy);
    replacement.encodes[0].result.resolve(canonical);
    await expect.poll(() => context.requests.length).toBe(2);
    expect(context.requests[1].command.expectedVersion).toBe(9);
    context.requests[1].result.resolve({ success: true });
    await retrying;
  });

  it.each(['replace', 'close', 'deactivate'])('fences a late encoded result after %s', async (transition) => {
    const context = setup();
    const decoded = await selectReady(context);
    const applying = context.editor.apply(policy);
    if (transition === 'replace') await selectReady(context);
    if (transition === 'close') { context.editor.close(); context.editor.open(); }
    if (transition === 'deactivate') { context.deactivate(); context.editor.activate(); context.editor.open(); }
    const current = context.editor.getSnapshot();
    decoded.encodes[0].result.resolve(canonical);
    await applying;
    expect(context.editor.getSnapshot()).toBe(current);
    expect(context.requests).toEqual([]);
    expect(decoded.isDisposed()).toBe(true);
    expect(context.notices).toEqual([]);
  });

  it.each(['success', 'failure', 'conflict'])('ignores obsolete request %s feedback after reopening', async (outcome) => {
    const context = setup();
    const decoded = await selectReady(context);
    const applying = context.editor.apply(policy);
    decoded.encodes[0].result.resolve(canonical);
    await expect.poll(() => context.requests.length).toBe(1);
    context.editor.close(); context.editor.open();
    const current = context.editor.getSnapshot();
    context.requests[0].result.resolve(outcome === 'success' ? { success: true } : { success: false, error: { message: 'Failed', versionConflict: outcome === 'conflict' } });
    await applying;
    expect(context.editor.getSnapshot()).toBe(current);
    expect(context.notices).toEqual([]);
    expect(context.refreshes).toEqual([]);
  });

  it.each(['success', 'failure'])('ignores obsolete refresh %s after replacing the session', async (outcome) => {
    const context = setup();
    const decoded = await selectReady(context);
    const applying = context.editor.apply(policy);
    decoded.encodes[0].result.resolve(canonical);
    await expect.poll(() => context.requests.length).toBe(1);
    context.requests[0].result.resolve({ success: false, error: { message: 'Conflict', versionConflict: true } });
    await expect.poll(() => context.refreshes.length).toBe(1);
    context.editor.close(); context.editor.open();
    const current = context.editor.getSnapshot();
    if (outcome === 'success') context.refreshes[0].resolve({ version: 7 });
    else context.refreshes[0].reject(new Error('Offline'));
    await applying;
    expect(context.editor.getSnapshot()).toBe(current);
    expect(context.notices).toEqual([]);
  });
});

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
