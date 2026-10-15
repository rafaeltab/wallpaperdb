import { pictureSelection } from '@/features/profile-management';
import type {
  PictureCrop,
  PictureEditorDependencies,
  PictureEditorProfile,
  PictureEditorSnapshot,
  PictureEncodingPolicy,
  PictureSelection,
} from './contract';
import { initialPictureCrop } from './crop';

export function createPictureEditor(
  profile: PictureEditorProfile,
  dependencies: PictureEditorDependencies
) {
  let active = false;
  let session = 0;
  let operation: AbortController | null = null;
  let state: PictureEditorSnapshot = {
    open: false,
    selection: null,
    processing: false,
    error: null,
  };
  const listeners = new Set<() => void>();
  function update(patch: Partial<PictureEditorSnapshot>) {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  }
  function cancel() {
    operation?.abort();
    operation = null;
    update({ processing: false });
  }
  function clear() {
    cancel();
    state.selection?.source?.dispose();
    if (state.selection?.previewUrl) dependencies.previews.release(state.selection.previewUrl);
    update({ selection: null, error: null });
  }
  function close() {
    session++;
    clear();
    update({ open: false });
  }
  async function decode(selected: PictureSelection, controller: AbortController) {
    const source = await dependencies.openSource(selected.file, controller.signal, profile.limits);
    if (controller.signal.aborted || state.selection !== selected) {
      source.dispose();
      return null;
    }
    const decoded = {
      ...selected,
      source,
      crop: initialPictureCrop(source),
      previewUrl: dependencies.previews.create(source.preview),
    };
    update({ selection: decoded });
    return decoded;
  }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    activate() {
      active = true;
      return () => {
        active = false;
        close();
      };
    },
    receiveProfile(next: PictureEditorProfile) {
      profile = next;
    },
    open() {
      if (active) {
        close();
        update({ open: true });
      }
    },
    close,
    cancel,
    async apply(policy?: PictureEncodingPolicy) {
      if (
        !active ||
        !state.open ||
        !policy ||
        dependencies.availability.isBusy() ||
        operation ||
        !state.selection ||
        state.selection.expectedVersion === null
      )
        return;
      let selected = state.selection;
      const originatingSession = session;
      const controller = new AbortController();
      operation = controller;
      update({ processing: true, error: null });
      try {
        if (!selected.source) {
          const decoded = await decode(selected, controller);
          if (!decoded) return;
          selected = decoded;
        }
        if (!selected.source || !selected.crop || selected.expectedVersion === null) return;
        const blob = await selected.source.process(selected.crop, policy, controller.signal);
        if (controller.signal.aborted || state.selection !== selected) return;
        if (dependencies.availability.isBusy())
          throw new Error(
            'Your Profile is busy. Apply the picture again after the current change finishes.'
          );
        operation = null;
        update({ processing: false });
        const result = await dependencies.save({
          action: 'upload',
          picture: new File([blob], 'profile-picture.webp', { type: 'image/webp' }),
          expectedVersion: selected.expectedVersion,
        });
        if (!active || session !== originatingSession) return;
        if (result.success) {
          close();
          dependencies.notify('Profile picture saved');
        } else update({ error: result.error.message });
      } catch (cause) {
        if (!controller.signal.aborted && state.selection === selected)
          update({
            error:
              cause instanceof Error ? cause.message : 'Unable to process this picture. Try again.',
          });
      } finally {
        if (operation === controller) {
          operation = null;
          update({ processing: false });
        }
      }
    },
    setCrop(crop: PictureCrop) {
      if (state.selection) update({ selection: { ...state.selection, crop } });
    },
    async select(
      file: File | undefined,
      policy?: PictureEncodingPolicy & { acceptedSourceFormats: string[] }
    ) {
      if (!active || !state.open || !policy || dependencies.availability.isBusy()) return;
      clear();
      const result = pictureSelection(file, policy.acceptedSourceFormats);
      update({ error: result.error });
      if (!result.selected) return;
      const selected: PictureSelection = {
        file: result.selected,
        expectedVersion: profile.version,
        source: null,
        crop: null,
        previewUrl: null,
      };
      const controller = new AbortController();
      operation = controller;
      update({ selection: selected, processing: true });
      try {
        await decode(selected, controller);
      } catch (cause) {
        if (!controller.signal.aborted && state.selection === selected)
          update({
            error:
              cause instanceof Error ? cause.message : 'Unable to decode this picture. Try again.',
          });
      } finally {
        if (operation === controller) {
          operation = null;
          update({ processing: false });
        }
      }
    },
  };
}
