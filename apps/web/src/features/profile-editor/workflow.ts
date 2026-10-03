import type {
  EditableProfile,
  ProfileDraft,
  ProfileEditorDependencies,
  ProfileEditorOptions,
  ProfileEditorSnapshot,
  SavePhase,
  SaveResult,
} from './contract';
import { aliasesToSchedule, fieldError } from './policy';

export function createProfileEditor(
  options: ProfileEditorOptions,
  dependencies: ProfileEditorDependencies
) {
  const { field, displayNameMaxLength } = options;
  const label = {
    displayName: 'display name',
    handle: 'profile handle',
    biographyMarkdown: 'biography',
  }[field];
  const title = label[0].toUpperCase() + label.slice(1);
  let profile = options.profile;
  let edit: ProfileDraft | null = null;
  let phase: SavePhase = 'idle';
  let error: string | null = null;
  let conflict = false;
  let refreshing = false;
  let confirmation: ProfileEditorSnapshot['confirmation'] = null;
  let serverDeadline: number | undefined;
  let enabled = false;
  let generation = 0;
  let cancelFeedback: (() => void) | undefined;
  let cancelCooldown: (() => void) | undefined;
  const listeners = new Set<() => void>();

  function draft(value: EditableProfile): ProfileDraft {
    return {
      value: value[field],
      baseValue: value[field],
      baseVersion: value.version,
      baseProfile: value,
    };
  }

  function getState(): ProfileEditorSnapshot {
    const now = dependencies.clock.now();
    const deadline =
      serverDeadline ??
      (profile.lastHandleChangedAt != null
        ? profile.lastHandleChangedAt + 7 * 24 * 60 * 60 * 1000
        : Number.NaN);
    const coolingDown = field === 'handle' && deadline > now;
    const validationError = edit
      ? fieldError(field, edit.value, profile, displayNameMaxLength)
      : undefined;
    const locked = phase === 'saving' || phase === 'success';
    return {
      edit,
      phase,
      error,
      conflict,
      confirmation,
      refreshing,
      validationError,
      locked,
      deadline,
      now,
      coolingDown,
      canSave: Boolean(
        edit &&
          edit.value !== edit.baseValue &&
          !validationError &&
          phase === 'idle' &&
          !coolingDown &&
          !refreshing
      ),
    };
  }
  let current = getState();
  function publish() {
    current = getState();
    for (const listener of listeners) listener();
  }
  function scheduleCooldown() {
    cancelCooldown?.();
    cancelCooldown = undefined;
    const state = getState();
    if (enabled && state.coolingDown)
      cancelCooldown = dependencies.clock.schedule(
        Math.min(state.deadline - state.now, 60000),
        () => {
          publish();
          scheduleCooldown();
        }
      );
  }
  function clearFeedback() {
    cancelFeedback?.();
    cancelFeedback = undefined;
  }
  function close() {
    clearFeedback();
    edit = null;
    phase = 'idle';
    error = null;
    conflict = false;
    confirmation = null;
    publish();
  }
  function feedback(callback: () => void) {
    clearFeedback();
    cancelFeedback = dependencies.clock.schedule(1600, callback);
  }
  function succeed(command: ProfileDraft, updated: EditableProfile) {
    profile = updated;
    edit = draft(updated);
    phase = 'success';
    if (field === 'handle') serverDeadline = undefined;
    dependencies.notify({
      kind: 'success',
      message:
        field === 'handle' && updated.handle === command.baseValue
          ? 'Profile handle unchanged'
          : `${title} updated`,
    });
    feedback(close);
    scheduleCooldown();
    publish();
  }
  function fail(result: Extract<SaveResult, { success: false }>) {
    const failure = result.error;
    if (failure.nextHandleChangeAt !== undefined) serverDeadline = failure.nextHandleChangeAt;
    conflict = Boolean(failure.versionConflict);
    error = conflict
      ? 'Your profile changed elsewhere. Refresh profile to keep your draft and try again.'
      : failure.message;
    phase = 'error';
    dependencies.notify({
      kind: 'error',
      message: `Unable to save ${label}`,
      description: failure.message,
    });
    feedback(() => {
      phase = 'idle';
      publish();
    });
    scheduleCooldown();
    publish();
  }
  async function save(command = edit, confirmed = false) {
    if (!enabled || !command || !getState().canSave || dependencies.isBusy()) return;
    const aliases = field === 'handle' ? aliasesToSchedule(command.baseProfile, command.value) : [];
    if (!confirmed && aliases.length) {
      confirmation = { command, aliases };
      publish();
      return;
    }
    confirmation = null;
    phase = 'saving';
    error = null;
    publish();
    const requestGeneration = generation;
    let result: SaveResult;
    try {
      result = await dependencies.save(command);
    } catch (cause) {
      result = {
        success: false,
        error: { message: cause instanceof Error ? cause.message : `Unable to save ${label}.` },
      };
    }
    if (!enabled || generation !== requestGeneration) return;
    if (result.success) succeed(command, result.profile);
    else fail(result);
  }
  async function refresh() {
    if (!enabled || getState().locked || refreshing || dependencies.isBusy()) return;
    refreshing = true;
    publish();
    const requestGeneration = generation;
    try {
      const updated = await dependencies.refresh();
      if (!enabled || generation !== requestGeneration) return;
      profile = updated;
      if (edit)
        edit = {
          ...draft(updated),
          value: edit.value === edit.baseValue ? updated[field] : edit.value,
        };
      conflict = false;
      error = null;
      clearFeedback();
      phase = 'idle';
      scheduleCooldown();
    } catch {
      if (!enabled || generation !== requestGeneration) return;
      error = 'Unable to refresh profile. Try again.';
      dependencies.notify({ kind: 'error', message: 'Unable to refresh profile' });
    } finally {
      if (enabled && generation === requestGeneration) {
        refreshing = false;
        publish();
      }
    }
  }
  return {
    getSnapshot: () => current,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    activate() {
      enabled = true;
      generation++;
      phase = 'idle';
      refreshing = false;
      scheduleCooldown();
      publish();
      return () => {
        enabled = false;
        generation++;
        clearFeedback();
        cancelCooldown?.();
        cancelCooldown = undefined;
      };
    },
    receiveProfile(updated: EditableProfile) {
      if (updated === profile || updated.id !== profile.id) return;
      profile = updated;
      if (edit && edit.value === edit.baseValue) edit = draft(updated);
      scheduleCooldown();
      publish();
    },
    beginEdit() {
      if (!enabled || getState().locked || getState().coolingDown || dependencies.isBusy()) return;
      edit = draft(profile);
      publish();
    },
    change(value: string) {
      if (!edit || getState().locked || refreshing || dependencies.isBusy()) return;
      edit = { ...edit, value };
      publish();
    },
    cancel() {
      if (getState().locked) return;
      close();
    },
    dismissConfirmation() {
      confirmation = null;
      publish();
    },
    confirmSave() {
      if (confirmation) return save(confirmation.command, true);
    },
    save,
    refresh,
  };
}
