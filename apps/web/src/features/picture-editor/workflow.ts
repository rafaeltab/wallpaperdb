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
    setCrop(crop: PictureCrop) {
      if (state.selection) update({ selection: { ...state.selection, crop } });
    },
    async select(
      file: File | undefined,
      policy?: PictureEncodingPolicy & { acceptedSourceFormats: string[] }
    ) {
      if (!active || !state.open || !policy) return;
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
