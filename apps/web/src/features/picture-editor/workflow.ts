import { pictureSelection } from '@/features/profile-management';
import type {
  PictureCrop,
  PictureFile,
  PictureCommand,
  PictureEditorDependencies,
  PictureEditorProfile,
  PictureEditorSnapshot,
  PictureEncodingPolicy,
  PictureSelection,
} from './contract';
import { initialPictureCrop } from './crop';

export function createPictureEditor<Input extends PictureFile, Bytes>(
  profile: PictureEditorProfile,
  dependencies: PictureEditorDependencies<Input, Bytes>
) {
  let active = false;
  let session = 0;
  let owner: object | undefined;
  let operation: ReturnType<PictureEditorDependencies<Input, Bytes>['createOperation']> | null =
    null;
  let state: PictureEditorSnapshot<Input, Bytes> = {
    open: false,
    removeVersion: null,
    selection: null,
    processing: false,
    error: null,
    recovery: null,
  };
  const listeners = new Set<() => void>();
  function update(patch: Partial<PictureEditorSnapshot<Input, Bytes>>) {
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
    update({ open: false, recovery: null, removeVersion: null });
  }
  const current = (originatingSession: number) =>
    active &&
    state.open &&
    session === originatingSession &&
    owner === dependencies.ownership.getIdentity();
  async function refresh(originatingSession = session) {
    if (!current(originatingSession) || dependencies.availability.isBusy()) return;
    try {
      const updated = await dependencies.refresh();
      if (!current(originatingSession)) return;
      if (state.selection)
        update({ selection: { ...state.selection, expectedVersion: updated.version } });
      update({
        recovery: 'review',
        error: 'Your Profile changed elsewhere. Review the latest saved picture before retrying.',
      });
    } catch {
      if (current(originatingSession))
        update({
          error:
            'Your Profile changed elsewhere. Unable to refresh your saved Profile. Retry the refresh before saving.',
        });
    }
  }
  async function save(command: PictureCommand<Bytes>, originatingSession: number) {
    const result = await dependencies.save(command);
    if (!current(originatingSession)) return;
    if (result.success) {
      close();
      dependencies.notify(
        command.action === 'remove' ? 'Generated avatar selected' : 'Profile picture saved'
      );
    } else if (result.error.versionConflict) {
      if (state.selection) update({ selection: { ...state.selection, expectedVersion: null } });
      update({
        recovery: 'required',
        error: 'Your Profile changed elsewhere. Refreshing your saved Profile…',
      });
      await refresh(originatingSession);
    } else update({ error: result.error.message });
  }
  async function decode(
    selected: PictureSelection<Input, Bytes>,
    controller: NonNullable<typeof operation>
  ) {
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
      const unsubscribe = dependencies.ownership.subscribe(() => {
        if (state.open && owner !== dependencies.ownership.getIdentity()) close();
      });
      return () => {
        unsubscribe();
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
        owner = dependencies.ownership.getIdentity();
        update({ open: true });
      }
    },
    close,
    cancel,
    returnToSelection() {
      if (!current(session) || operation || dependencies.availability.isBusy()) return false;
      clear();
      return true;
    },
    requestRemoval() {
      if (
        current(session) &&
        !operation &&
        !dependencies.availability.isBusy() &&
        state.recovery !== 'required'
      )
        update({ removeVersion: profile.version });
    },
    cancelRemoval() {
      update({ removeVersion: null });
    },
    async confirmRemoval() {
      if (
        !current(session) ||
        operation ||
        dependencies.availability.isBusy() ||
        state.recovery === 'required' ||
        state.removeVersion === null
      )
        return;
      const expectedVersion = state.removeVersion;
      update({ removeVersion: null });
      await save({ action: 'remove', expectedVersion }, session);
    },
    refresh: () => refresh(),
    async apply(policy?: PictureEncodingPolicy) {
      if (
        !current(session) ||
        !policy ||
        dependencies.availability.isBusy() ||
        operation ||
        state.recovery === 'required' ||
        !state.selection ||
        state.selection.expectedVersion === null
      )
        return;
      let selected = state.selection;
      const originatingSession = session;
      const controller = dependencies.createOperation();
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
        if (
          controller.signal.aborted ||
          state.selection !== selected ||
          !current(originatingSession)
        )
          return;
        if (dependencies.availability.isBusy())
          throw new Error(
            'Your Profile is busy. Apply the picture again after the current change finishes.'
          );
        operation = null;
        update({ processing: false });
        await save(
          {
            action: 'upload',
            picture: blob,
            expectedVersion: selected.expectedVersion,
          },
          originatingSession
        );
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
      file: Input | undefined,
      policy?: PictureEncodingPolicy & { acceptedSourceFormats: string[] }
    ) {
      if (!current(session) || !policy || dependencies.availability.isBusy()) return;
      clear();
      const result = pictureSelection(file, policy.acceptedSourceFormats);
      update({ error: result.error });
      if (!result.selected) return;
      const selected: PictureSelection<Input, Bytes> = {
        file: result.selected,
        expectedVersion: state.recovery === 'required' ? null : profile.version,
        source: null,
        crop: null,
        previewUrl: null,
      };
      const controller = dependencies.createOperation();
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
