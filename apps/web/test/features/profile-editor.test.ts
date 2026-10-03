import { describe, expect, it } from 'vitest';
import {
  createProfileEditor,
  type EditableProfile,
  type SaveResult,
} from '@/features/profile-editor';

const profile: EditableProfile = {
  id: 'owner',
  displayName: 'Ada',
  handle: 'ada',
  biographyMarkdown: 'Original',
  version: 1,
};
function setup(
  field: 'displayName' | 'handle' | 'biographyMarkdown' = 'displayName',
  initial = profile,
  refreshProfile: () => Promise<EditableProfile> = async () => ({
    ...initial,
    displayName: 'Remote',
    version: 3,
  })
) {
  let now = 0;
  let busy = false;
  const timers = new Set<{ at: number; callback: () => void }>();
  const requests: {
    command: { value: string; baseVersion: number };
    resolve: (result: SaveResult) => void;
  }[] = [];
  const notices: { kind: string; message: string; description?: string }[] = [];
  const editor = createProfileEditor(
    { field, profile: initial, displayNameMaxLength: 80 },
    {
      save(command) {
        return new Promise<SaveResult>((resolve) => {
          requests.push({ command, resolve });
        });
      },
      refresh: refreshProfile,
      isBusy: () => busy,
      notify: (notice) => {
        notices.push(notice);
      },
      clock: {
        now: () => now,
        schedule(delay, callback) {
          const timer = { at: now + delay, callback };
          timers.add(timer);
          return () => {
            timers.delete(timer);
          };
        },
      },
    }
  );
  const deactivate = editor.activate();
  function advance(ms: number) {
    now += ms;
    for (const timer of [...timers]) if (timer.at <= now && timers.delete(timer)) timer.callback();
  }
  return {
    editor,
    requests,
    notices,
    advance,
    timers,
    deactivate,
    setBusy: (value: boolean) => {
      busy = value;
    },
  };
}

async function resolveSave(
  request: ReturnType<typeof setup>['requests'][number],
  result: SaveResult
) {
  request.resolve(result);
  await Promise.resolve();
}

describe('profile editor workflow', () => {
  it('saves the raw draft and captured version, locks feedback, then closes after success', async () => {
    const { editor, requests, advance, notices } = setup();
    editor.beginEdit();
    editor.change('  Ada  Byron ');
    void editor.save();
    expect(requests[0].command).toMatchObject({ value: '  Ada  Byron ', baseVersion: 1 });
    expect(editor.getSnapshot().phase).toBe('saving');
    void editor.save();
    expect(requests).toHaveLength(1);
    await resolveSave(requests[0], {
      success: true,
      profile: { ...profile, displayName: 'Ada Byron', version: 2 },
    });
    expect(editor.getSnapshot()).toMatchObject({
      phase: 'success',
      edit: { value: 'Ada Byron', baseVersion: 2 },
    });
    expect(notices[0].message).toBe('Display name updated');
    advance(1600);
    expect(editor.getSnapshot().edit).toBeNull();
  });
});

describe('profile editor decisions', () => {
  it('follows a refreshed profile only while the draft is pristine', () => {
    const { editor } = setup();
    editor.beginEdit();
    editor.receiveProfile({ ...profile, displayName: 'Remote', version: 2 });
    expect(editor.getSnapshot().edit).toMatchObject({ value: 'Remote', baseVersion: 2 });
    editor.change('My draft');
    editor.receiveProfile({ ...profile, displayName: 'Other', version: 3 });
    expect(editor.getSnapshot().edit).toMatchObject({
      value: 'My draft',
      baseValue: 'Remote',
      baseVersion: 2,
    });
    editor.cancel();
    editor.beginEdit();
    expect(editor.getSnapshot().edit?.value).toBe('Other');
  });

  it('preserves a failed draft, shows feedback, and permits a later retry', async () => {
    const { editor, requests, advance, notices } = setup();
    editor.beginEdit();
    editor.change('My draft');
    void editor.save();
    await resolveSave(requests[0], { success: false, error: { message: 'Offline' } });
    expect(editor.getSnapshot()).toMatchObject({
      phase: 'error',
      error: 'Offline',
      edit: { value: 'My draft' },
    });
    expect(notices[0]).toMatchObject({ kind: 'error', description: 'Offline' });
    void editor.save();
    expect(requests).toHaveLength(1);
    advance(1600);
    void editor.save();
    expect(requests).toHaveLength(2);
  });

  it('rebases a conflict explicitly and preserves the dirty draft', async () => {
    const { editor, requests } = setup();
    editor.beginEdit();
    editor.change('My draft');
    void editor.save();
    await resolveSave(requests[0], {
      success: false,
      error: { message: 'Conflict', versionConflict: true },
    });
    expect(editor.getSnapshot().conflict).toBe(true);
    await editor.refresh();
    expect(editor.getSnapshot()).toMatchObject({
      phase: 'idle',
      conflict: false,
      error: null,
      edit: { value: 'My draft', baseValue: 'Remote', baseVersion: 3 },
    });
    void editor.save();
    expect(requests[1].command.baseVersion).toBe(3);
  });

  it('never submits unchanged, invalid, busy or cancelled drafts', () => {
    const { editor, requests, setBusy } = setup();
    editor.beginEdit();
    void editor.save();
    editor.change('   ');
    void editor.save();
    expect(editor.getSnapshot().validationError).toContain('must not be blank');
    editor.change('😀'.repeat(81));
    void editor.save();
    expect(editor.getSnapshot().validationError).toContain('80 characters');
    editor.change('Valid');
    setBusy(true);
    void editor.save();
    setBusy(false);
    editor.cancel();
    void editor.save();
    expect(requests).toHaveLength(0);
  });

  it('supports empty biography and validates Markdown at the configured codepoint limit', () => {
    const { editor, requests } = setup('biographyMarkdown', { ...profile, biographyMaxLength: 10 });
    editor.beginEdit();
    editor.change('😀'.repeat(11));
    void editor.save();
    expect(editor.getSnapshot().validationError).toBeDefined();
    editor.change('<script>oops</script>');
    void editor.save();
    expect(editor.getSnapshot().validationError).toBeDefined();
    editor.change('');
    void editor.save();
    expect(requests[0].command.value).toBe('');
  });

  it('captures alias confirmation and its version, supports cancelling, then submits that command', () => {
    const { editor, requests } = setup('handle', {
      ...profile,
      retainedAliasLimit: 1,
      aliases: [{ handle: 'old' }, { handle: 'expired', expiresAt: 'expired' }],
    });
    editor.beginEdit();
    editor.change('Áda Byron!');
    void editor.save();
    expect(editor.getSnapshot().confirmation).toMatchObject({
      aliases: ['old'],
      command: { value: 'Áda Byron!', baseVersion: 1 },
    });
    editor.dismissConfirmation();
    expect(editor.getSnapshot().edit?.value).toBe('Áda Byron!');
    void editor.save();
    editor.receiveProfile({ ...profile, version: 8 });
    void editor.confirmSave();
    expect(requests[0].command).toMatchObject({ value: 'Áda Byron!', baseVersion: 1 });
  });

  it('requires no alias-removal confirmation for normalization to the same handle or promotion', () => {
    const { editor, requests } = setup('handle', {
      ...profile,
      retainedAliasLimit: 1,
      aliases: [{ handle: 'retained' }],
    });
    editor.beginEdit();
    editor.change('Áda!');
    void editor.save();
    expect(requests).toHaveLength(1);
    const promoted = setup('handle', {
      ...profile,
      retainedAliasLimit: 1,
      aliases: [{ handle: 'retained' }],
    });
    promoted.editor.beginEdit();
    promoted.editor.change('retained');
    void promoted.editor.save();
    expect(promoted.requests).toHaveLength(1);
  });

  it('blocks handle editing during cooldown and releases it at the deadline', () => {
    const { editor, advance } = setup('handle', { ...profile, lastHandleChangedAt: 0 });
    editor.beginEdit();
    expect(editor.getSnapshot().edit).toBeNull();
    expect(editor.getSnapshot().coolingDown).toBe(true);
    advance(7 * 24 * 60 * 60 * 1000);
    expect(editor.getSnapshot().coolingDown).toBe(false);
    editor.beginEdit();
    expect(editor.getSnapshot().edit).not.toBeNull();
  });

  it('uses the current clock for newly received deadlines', () => {
    const { editor, advance } = setup('handle');
    advance(20 * 24 * 60 * 60 * 1000);
    editor.receiveProfile({ ...profile, lastHandleChangedAt: 0, version: 2 });
    expect(editor.getSnapshot().coolingDown).toBe(false);
    editor.receiveProfile({
      ...profile,
      lastHandleChangedAt: 20 * 24 * 60 * 60 * 1000,
      version: 3,
    });
    expect(editor.getSnapshot().coolingDown).toBe(true);
  });

  it('honors a server-supplied deadline without losing the draft', async () => {
    const { editor, requests, advance } = setup('handle');
    editor.beginEdit();
    editor.change('new');
    void editor.save();
    await resolveSave(requests[0], {
      success: false,
      error: { message: 'Wait', nextHandleChangeAt: 3000 },
    });
    expect(editor.getSnapshot().coolingDown).toBe(true);
    advance(1600);
    void editor.save();
    expect(requests).toHaveLength(1);
    advance(1400);
    void editor.save();
    expect(requests).toHaveLength(2);
  });

  it('ignores late responses and releases timers after deactivation', async () => {
    const { editor, requests, notices, deactivate, timers } = setup();
    editor.beginEdit();
    editor.change('Late');
    void editor.save();
    deactivate();
    const before = editor.getSnapshot();
    await resolveSave(requests[0], {
      success: true,
      profile: { ...profile, displayName: 'Late', version: 2 },
    });
    expect(editor.getSnapshot()).toBe(before);
    expect(notices).toEqual([]);
    expect(timers.size).toBe(0);
    editor.activate();
    expect(editor.getSnapshot().phase).toBe('idle');
    void editor.save();
    expect(requests).toHaveLength(2);
  });

  it('provides stable observable snapshots and supports unsubscribe', () => {
    const { editor } = setup();
    let changes = 0;
    const unsubscribe = editor.subscribe(() => {
      changes++;
    });
    expect(editor.getSnapshot()).toBe(editor.getSnapshot());
    editor.beginEdit();
    expect(changes).toBe(1);
    unsubscribe();
    editor.change('Next');
    expect(changes).toBe(1);
  });
});

describe('profile editor lifecycle and refresh failures', () => {
  it('keeps the draft and conflict when refresh fails, and permits a later refresh', async () => {
    const { editor, requests, notices } = setup('displayName', profile, async () => {
      throw new Error('Offline');
    });
    editor.beginEdit();
    editor.change('Draft');
    void editor.save();
    await resolveSave(requests[0], {
      success: false,
      error: { message: 'Conflict', versionConflict: true },
    });
    await editor.refresh();
    expect(editor.getSnapshot()).toMatchObject({
      refreshing: false,
      conflict: true,
      edit: { value: 'Draft', baseVersion: 1 },
      error: 'Unable to refresh profile. Try again.',
    });
    expect(notices.at(-1)?.message).toBe('Unable to refresh profile');
  });

  it('serializes refreshes and ignores a refresh that finishes after deactivation', async () => {
    let resolve!: (profile: EditableProfile) => void;
    let refreshes = 0;
    const { editor, deactivate, notices } = setup('displayName', profile, () => {
      refreshes++;
      return new Promise((done) => {
        resolve = done;
      });
    });
    editor.beginEdit();
    editor.change('Draft');
    const refreshing = editor.refresh();
    void editor.refresh();
    expect(refreshes).toBe(1);
    expect(editor.getSnapshot().refreshing).toBe(true);
    editor.change('Ignored');
    expect(editor.getSnapshot().edit?.value).toBe('Draft');
    deactivate();
    const before = editor.getSnapshot();
    resolve({ ...profile, version: 9 });
    await refreshing;
    expect(editor.getSnapshot()).toBe(before);
    expect(notices).toEqual([]);
  });

  it('preserves a dirty draft on cancel during refresh and reopening after completion', async () => {
    let resolve!: (profile: EditableProfile) => void;
    const { editor } = setup(
      'displayName',
      profile,
      () =>
        new Promise((done) => {
          resolve = done;
        })
    );
    editor.beginEdit();
    editor.change('Draft');
    const refreshing = editor.refresh();
    editor.cancel();
    resolve({ ...profile, displayName: 'Remote', version: 3 });
    await refreshing;
    expect(editor.getSnapshot().edit).toBeNull();
    editor.beginEdit();
    expect(editor.getSnapshot().edit).toMatchObject({ value: 'Remote', baseVersion: 3 });
  });

  it('never edits or cancels an in-flight save, and cleans feedback timers on deactivation', async () => {
    const { editor, requests, deactivate, timers } = setup();
    editor.beginEdit();
    editor.change('Draft');
    void editor.save();
    editor.change('Ignored');
    editor.cancel();
    expect(editor.getSnapshot().edit?.value).toBe('Draft');
    await resolveSave(requests[0], {
      success: true,
      profile: { ...profile, displayName: 'Draft', version: 2 },
    });
    expect(timers.size).toBe(1);
    deactivate();
    expect(timers.size).toBe(0);
  });

  it('reports a normalization-only handle save without imposing a new cooldown', async () => {
    const { editor, requests, notices } = setup('handle');
    editor.beginEdit();
    editor.change('Áda!');
    void editor.save();
    await resolveSave(requests[0], { success: true, profile: { ...profile, version: 1 } });
    expect(notices[0].message).toBe('Profile handle unchanged');
    expect(editor.getSnapshot().coolingDown).toBe(false);
  });
});
