import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProfileOutcome } from '../src/profile/index.js';
import { controlledProfiles } from './helpers/profiles.js';

function accepted(result: ProfileOutcome) {
  if (result._tag !== 'Success') throw new Error(result.message);
  return result.profile;
}
const principal = { profileId: 'owner' };
const identity = (displayName: string | null) => ({ displayName, firstName: null, lastName: null });
const at = (date: string) => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(date));
};
afterEach(() => vi.useRealTimers());

describe('Profiles capability', () => {
  it('keeps a collision suffix within minimum length after trimming its stem', async () => {
    const test = controlledProfiles({ profileHandleMinLength: 10, profileHandleMaxLength: 10 });
    const identity = { displayName: 'Ab Cd Efgh', firstName: null, lastName: null };
    expect((await test.ensure('first', identity)).handle).toBe('ab-cd-efgh');
    const second = await test.ensure('second', identity);
    expect(second.handle).toHaveLength(10);
    expect(second.handle).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    expect(second.handle).not.toBe('ab-cd-efgh');
  });
  it('keeps a generated handle inside the configured minimum when truncation removes a trailing hyphen', async () => {
    const test = controlledProfiles({ profileHandleMinLength: 3, profileHandleMaxLength: 3 });
    test.setIdentity('owner', { displayName: 'Ab cd', firstName: null, lastName: null });
    expect(await test.run((profiles) => profiles.ensure({ profileId: 'owner' }))).toMatchObject({
      _tag: 'Success',
      profile: { handle: 'ab0' },
    });
  });
  it('normalizes changed details once and preserves the version on a repeated no-op', async () => {
    const test = controlledProfiles();
    await test.ensure();
    expect(
      await test.run((profiles) =>
        profiles.updateDetails({ profileId: 'owner' }, { displayName: '  Ada   Lovelace ' }, 1)
      )
    ).toMatchObject({ _tag: 'Success', profile: { displayName: 'Ada Lovelace', version: 2 } });
    expect(
      await test.run((profiles) =>
        profiles.updateDetails({ profileId: 'owner' }, { displayName: 'Ada Lovelace' }, 2)
      )
    ).toMatchObject({ _tag: 'Success', profile: { version: 2 } });
    expect(
      test.transitions
        .filter((entry) => entry.mutation.type !== 'created')
        .map((entry) => entry.mutation)
    ).toEqual([{ type: 'details', displayName: 'Ada Lovelace', biographyMarkdown: '' }]);
  });
  it('rejects a stale command even when its values would be unchanged', async () => {
    const test = controlledProfiles();
    await test.ensure();
    expect(
      await test.run((profiles) =>
        profiles.updateDetails({ profileId: 'owner' }, { displayName: 'Ada' }, 2)
      )
    ).toMatchObject({ _tag: 'Rejected', reason: 'version-conflict' });
    expect(
      test.transitions
        .filter((entry) => entry.mutation.type !== 'created')
        .map((entry) => entry.mutation)
    ).toEqual([]);
  });
  it('rejects a blank display name before persistence', async () => {
    const test = controlledProfiles();
    await test.ensure();
    expect(
      await test.run((profiles) =>
        profiles.updateDetails({ profileId: 'owner' }, { displayName: '  ' }, 1)
      )
    ).toEqual({
      _tag: 'Rejected',
      reason: 'invalid-display-name',
      message: 'Display name must not be blank',
    });
  });
  it('creates the authenticated owner with normalized identity and a public handle', async () => {
    const test = controlledProfiles();
    test.setIdentity('owner', {
      displayName: null,
      firstName: '  Ada ',
      lastName: ' Lovelace  ',
      imageUrl: null,
    });
    expect(await test.run((profiles) => profiles.ensure({ profileId: 'owner' }))).toMatchObject({
      _tag: 'Success',
      profile: { id: 'owner', displayName: 'Ada Lovelace', handle: 'ada-lovelace' },
    });
    expect(test.creations).toEqual([
      expect.objectContaining({
        profileId: 'owner',
        displayName: 'Ada Lovelace',
        handle: 'ada-lovelace',
        imageUrl: null,
      }),
    ]);
  });

  it('keeps existing owner state without fetching identity or creating another occurrence', async () => {
    const test = controlledProfiles();
    const first = await test.ensure();
    test.setIdentity('owner', identity('Changed'));
    expect(await test.ensure()).toEqual(first);
    expect(test.identityReads).toEqual(['owner']);
    expect(test.transitions).toHaveLength(1);
  });
  it('prioritizes full identity name and produces a stable fallback', async () => {
    const test = controlledProfiles();
    const full = await test.ensure('full', {
      displayName: null,
      firstName: 'Grace',
      lastName: 'Hopper',
    });
    expect(full).toMatchObject({ displayName: 'Grace Hopper', handle: 'grace-hopper' });
    const fallback = await test.ensure('fallback', identity(null));
    expect(fallback.displayName).toMatch(
      /^(quiet|bright|silver|wild) (aurora|canvas|horizon|pixel)$/
    );
    expect(fallback.handle).toBe(fallback.displayName.replace(' ', '-'));
    expect((await controlledProfiles().ensure('fallback', identity(null))).displayName).toBe(
      fallback.displayName
    );
  });
  it('normalizes and bounds the initial display name', async () => {
    const test = controlledProfiles({ profileDisplayNameMaxLength: 5 });
    expect(await test.ensure('owner', identity('  Éowyn\t Snow  '))).toMatchObject({
      displayName: 'Éowyn',
      handle: 'eowyn',
    });
  });
  it('avoids reserved initial handles before and after truncation', async () => {
    const test = controlledProfiles();
    for (const [display, handle] of [
      ['Admin', 'admin-profile'],
      ['GraphQL', 'graphql-profile'],
      ['Tags', 'tags-profile'],
    ]) {
      expect((await test.ensure(display, identity(display))).handle).toBe(handle);
    }
    expect(
      (await test.ensure('long', identity('A very long profile display name'))).handle.length
    ).toBeLessThanOrEqual(20);
    test.setPolicy({ profileHandleMaxLength: 8 });
    const security = await test.ensure('security', identity('Security'));
    expect(security.handle).not.toBe('security');
    expect(security.handle.length).toBeLessThanOrEqual(8);
  });
  it.each([1, 2, 3])('keeps collision handles within a maximum of %i', async (maximum) => {
    const test = controlledProfiles({ profileHandleMaxLength: maximum });
    const first = await test.ensure('first');
    const second = await test.ensure('second');
    expect(second.handle).not.toBe(first.handle);
    expect(second.handle.length).toBeLessThanOrEqual(maximum);
    expect(second.handle).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  });
  it('normalizes Unicode whitespace and rejects blank or over-limit names without a transition', async () => {
    const test = controlledProfiles();
    await test.ensure();
    const changed = accepted(
      await test.run((p) => p.updateDetails(principal, { displayName: '  Éowyn\t雪\nQueen  ' }, 1))
    );
    expect(changed).toMatchObject({ displayName: 'Éowyn 雪 Queen', version: 2 });
    test.setPolicy({ profileDisplayNameMaxLength: 3 });
    for (const displayName of [' \t\n ', '雪雪雪雪']) {
      expect(await test.run((p) => p.updateDetails(principal, { displayName }, 2))).toMatchObject({
        _tag: 'Rejected',
        reason: 'invalid-display-name',
      });
    }
    expect((await test.ensure()).displayName).toBe(changed.displayName);
    expect(test.transitions).toHaveLength(2);
  });
  it('clears Biography while preserving aliases and rejects stale no-ops', async () => {
    const test = controlledProfiles();
    const original = await test.ensure();
    const changed = accepted(
      await test.run((p) => p.changeHandle(principal, 'biography-writer', original.version))
    );
    const edited = accepted(
      await test.run((p) =>
        p.updateDetails(principal, { biographyMarkdown: 'Original **Biography**' }, changed.version)
      )
    );
    expect(
      await test.run((p) =>
        p.updateDetails(principal, { biographyMarkdown: edited.biographyMarkdown }, edited.version)
      )
    ).toEqual({ _tag: 'Success', profile: edited });
    expect(
      await test.run((p) =>
        p.updateDetails(principal, { biographyMarkdown: edited.biographyMarkdown }, changed.version)
      )
    ).toMatchObject({ _tag: 'Rejected', reason: 'version-conflict' });
    const cleared = accepted(
      await test.run((p) => p.updateDetails(principal, { biographyMarkdown: '' }, edited.version))
    );
    expect(cleared).toMatchObject({
      biographyMarkdown: '',
      version: edited.version + 1,
      aliases: changed.aliases,
    });
    expect(
      accepted(
        await test.run((p) =>
          p.updateDetails(principal, { biographyMarkdown: '' }, cleared.version)
        )
      )
    ).toEqual(cleared);
    expect(test.transitions.filter((t) => t.mutation.type === 'details')).toHaveLength(2);
  });
  it.each([
    '<script>alert(1)</script>',
    '[![Picture](wallpaper:wlpr_owned)](https://example.com)',
    '[Unsafe](javascript:alert%281%29)',
    '[Credentials](https://user:pass@example.com)',
    '![Remote](https://example.com/image.png)',
    '[Custom](wallpaper:wlpr_owned)',
    '![Data](data:image/png;base64,eA==)',
  ])('rejects unsafe Biography without applying either field: %s', async (biographyMarkdown) => {
    const test = controlledProfiles();
    const original = await test.ensure();
    expect(
      await test.run((p) =>
        p.updateDetails(principal, { displayName: 'Rejected Name', biographyMarkdown }, 1)
      )
    ).toMatchObject({ _tag: 'Rejected', reason: 'invalid-biography' });
    expect(await test.ensure()).toEqual(original);
    expect(test.transitions).toHaveLength(1);
  });
  it('distinguishes unavailable and foreign Wallpaper embeds before accepting owned publication', async () => {
    const test = controlledProfiles();
    const original = await test.ensure();
    const draft = {
      displayName: 'Updated Name',
      biographyMarkdown: '![Owned](wallpaper:wlpr_owned)',
    };
    expect(await test.run((p) => p.updateDetails(principal, draft, 1))).toMatchObject({
      _tag: 'Rejected',
      reason: 'unavailable-biography-wallpaper',
      retryable: true,
    });
    test.publishWallpaper('wlpr_owned', 'other');
    expect(await test.run((p) => p.updateDetails(principal, draft, 1))).toMatchObject({
      _tag: 'Rejected',
      reason: 'unavailable-biography-wallpaper',
      retryable: false,
    });
    expect(await test.ensure()).toEqual(original);
    test.publishWallpaper('wlpr_mine', 'owner');
    const authored = '![Mine](wallpaper:wlpr_mine)\n\n**My work**';
    expect(
      accepted(
        await test.run((p) => p.updateDetails(principal, { biographyMarkdown: authored }, 1))
      )
    ).toMatchObject({ biographyMarkdown: authored, version: 2 });
    expect(test.transitions).toHaveLength(2);
  });
  it('counts Biography Unicode code points without truncating authored text', async () => {
    const test = controlledProfiles({ profileBiographyMaxLength: 4 });
    expect((await test.ensure()).biographyMaxLength).toBe(4);
    const changed = accepted(
      await test.run((p) => p.updateDetails(principal, { biographyMarkdown: '👋abc' }, 1))
    );
    expect(changed.biographyMarkdown).toBe('👋abc');
    expect(
      await test.run((p) => p.updateDetails(principal, { biographyMarkdown: '👋abcd' }, 2))
    ).toMatchObject({ _tag: 'Rejected', reason: 'invalid-biography' });
    expect(await test.ensure()).toEqual(changed);
    expect(test.transitions).toHaveLength(2);
  });
  it('rejects reserved and out-of-range normalized Handles', async () => {
    const test = controlledProfiles({ profileHandleMinLength: 3, profileHandleMaxLength: 10 });
    const before = await test.ensure();
    for (const handle of [
      ' ADMÍN ',
      'sUpPoRt',
      'GraphQL',
      'settings',
      '--!!!',
      ' A ',
      'abcdefghijkl',
    ]) {
      expect(await test.run((p) => p.changeHandle(principal, handle, 1)), handle).toMatchObject({
        _tag: 'Rejected',
        reason: 'invalid-handle',
      });
    }
    expect(await test.ensure()).toEqual(before);
    expect(test.transitions).toHaveLength(1);
  });
  it('allows the exact seven-day cooldown boundary and normalized no-ops during cooldown', async () => {
    at('2030-01-01T12:00:00.000Z');
    const test = controlledProfiles();
    await test.ensure();
    const first = accepted(await test.run((p) => p.changeHandle(principal, 'first-handle', 1)));
    expect(
      accepted(await test.run((p) => p.changeHandle(principal, ' FIRST__HANDLE ', 2)))
    ).toEqual(first);
    expect(await test.run((p) => p.changeHandle(principal, 'first-handle', 1))).toMatchObject({
      _tag: 'Rejected',
      reason: 'version-conflict',
    });
    at('2030-01-08T11:59:59.999Z');
    expect(await test.run((p) => p.changeHandle(principal, 'second-handle', 2))).toMatchObject({
      _tag: 'Rejected',
      reason: 'handle-cooldown',
      nextHandleChangeAt: new Date('2030-01-08T12:00:00.000Z'),
    });
    expect(await test.ensure()).toEqual(first);
    at('2030-01-08T12:00:00.000Z');
    const next = accepted(await test.run((p) => p.changeHandle(principal, 'second-handle', 2)));
    expect(next).toMatchObject({
      handle: 'second-handle',
      version: 3,
      lastHandleChangedAt: new Date('2030-01-08T12:00:00.000Z'),
    });
    expect(next.aliases).toHaveLength(2);
    expect(test.transitions).toHaveLength(3);
  });

  it('returns retained dates and preserves a scheduled expiry on retries until release', async () => {
    at('2030-01-01T12:00:00.000Z');
    const test = controlledProfiles();
    const before = await test.ensure();
    await test.ensure('other');
    expect(before).toMatchObject({ retainedAliasLimit: 3, aliases: [] });
    const changed = accepted(await test.run((p) => p.changeHandle(principal, 'new-handle', 1)));
    expect(changed.aliases).toEqual([
      {
        handle: before.handle,
        claimGeneration: expect.any(Number),
        createdAt: '2030-01-01T12:00:00.000Z',
        expiresAt: null,
      },
    ]);
    const scheduled = accepted(
      await test.run((p) => p.scheduleAliasExpiry(principal, before.handle.toUpperCase(), 2))
    );
    expect(scheduled).toMatchObject({
      version: 3,
      lastHandleChangedAt: changed.lastHandleChangedAt,
      aliases: [{ ...changed.aliases[0], expiresAt: '2030-01-02T12:00:00.000Z' }],
    });
    at('2030-01-02T12:00:00.001Z');
    expect(
      accepted(await test.run((p) => p.scheduleAliasExpiry(principal, before.handle, 3)))
    ).toEqual(scheduled);
    expect(await test.run((p) => p.scheduleAliasExpiry(principal, before.handle, 2))).toMatchObject(
      { _tag: 'Rejected', reason: 'version-conflict' }
    );
    expect(
      await test.run((p) => p.changeHandle({ profileId: 'other' }, before.handle, 1))
    ).toMatchObject({ _tag: 'Rejected', reason: 'handle-unavailable' });
    const renamed = accepted(
      await test.run((p) => p.updateDetails(principal, { displayName: 'New name' }, 3))
    );
    expect(renamed).toMatchObject({ aliases: scheduled.aliases, retainedAliasLimit: 3 });
    expect(test.transitions.filter((t) => t.mutation.type === 'schedule')).toHaveLength(1);
  });
  it('allows only an owner to schedule or immediately expire an existing alias at the last-seen version', async () => {
    const test = controlledProfiles();
    const original = await test.ensure();
    await test.ensure('other');
    const changed = accepted(await test.run((p) => p.changeHandle(principal, 'current-handle', 1)));
    for (const command of [
      () => test.run((p) => p.scheduleAliasExpiry(principal, original.handle, 1)),
      () => test.run((p) => p.expireAliasImmediately(principal, original.handle, 1)),
      () => test.run((p) => p.reactivateAlias(principal, original.handle, 1)),
    ])
      expect(await command()).toMatchObject({ _tag: 'Rejected', reason: 'version-conflict' });
    for (const handle of [changed.handle, 'unclaimed-alias']) {
      expect(await test.run((p) => p.scheduleAliasExpiry(principal, handle, 2))).toMatchObject({
        _tag: 'Rejected',
        reason: 'alias-not-found',
      });
      expect(await test.run((p) => p.expireAliasImmediately(principal, handle, 2))).toMatchObject({
        _tag: 'Rejected',
        reason: 'alias-not-found',
      });
    }
    expect(
      await test.run((p) => p.scheduleAliasExpiry({ profileId: 'other' }, original.handle, 1))
    ).toMatchObject({ _tag: 'Rejected', reason: 'alias-not-found' });
    expect(
      await test.run((p) => p.expireAliasImmediately(principal, original.handle, 2))
    ).toMatchObject({ _tag: 'Rejected', reason: 'alias-not-scheduled' });
    expect(await test.ensure()).toEqual(changed);
    expect(test.transitions).toHaveLength(3);
    const scheduled = accepted(
      await test.run((p) => p.scheduleAliasExpiry(principal, original.handle, 2))
    );
    expect(
      await test.run((p) => p.expireAliasImmediately({ profileId: 'other' }, original.handle, 1))
    ).toMatchObject({ _tag: 'Rejected', reason: 'alias-not-found' });
    const expired = accepted(
      await test.run((p) => p.expireAliasImmediately(principal, original.handle, scheduled.version))
    );
    expect(expired).toMatchObject({
      handle: changed.handle,
      aliases: [],
      version: 4,
      lastHandleChangedAt: changed.lastHandleChangedAt,
    });
    expect(
      await test.run((p) => p.expireAliasImmediately(principal, original.handle, 4))
    ).toMatchObject({ _tag: 'Rejected', reason: 'alias-not-found' });
  });
  it.each([
    0, 1,
  ])('rejects scheduled and released reactivation with no slot at limit %i', async (limit) => {
    at('2030-01-01T00:00:00.000Z');
    const test = controlledProfiles();
    const original = await test.ensure();
    const changed = accepted(await test.run((p) => p.changeHandle(principal, 'second-handle', 1)));
    const scheduled = accepted(
      await test.run((p) => p.scheduleAliasExpiry(principal, original.handle, changed.version))
    );
    at('2030-01-08T00:00:00.000Z');
    if (limit === 1)
      accepted(
        await test.run((p) => p.changeHandle(principal, 'current-handle', scheduled.version))
      );
    test.setPolicy({ profileRetainedAliasLimit: limit });
    const before = await test.ensure();
    expect(before.historicalHandles).toContainEqual({
      handle: original.handle,
      eligibleUntil: '2030-01-31T00:00:00.000Z',
      unavailableReason: 'alias-limit',
    });
    expect(
      await test.run((p) => p.reactivateAlias(principal, original.handle, before.version))
    ).toMatchObject({ _tag: 'Rejected', reason: 'alias-limit' });
    expect(await test.ensure()).toEqual(before);
    const released = accepted(
      await test.run((p) => p.expireAliasImmediately(principal, original.handle, before.version))
    );
    expect(
      await test.run((p) => p.reactivateAlias(principal, original.handle, released.version))
    ).toMatchObject({ _tag: 'Rejected', reason: 'alias-limit' });
    expect(await test.ensure()).toEqual(released);
    expect(released.aliases).toEqual(
      before.aliases.filter((alias) => alias.handle !== original.handle)
    );
    expect(test.transitions.filter((t) => t.mutation.type === 'reactivate')).toHaveLength(0);
  });
  it('reports another owner claim as unavailable and rejects reactivation', async () => {
    const test = controlledProfiles();
    const original = await test.ensure();
    await test.run((p) => p.changeHandle(principal, 'current-handle', 1));
    await test.run((p) => p.scheduleAliasExpiry(principal, original.handle, 2));
    const released = accepted(
      await test.run((p) => p.expireAliasImmediately(principal, original.handle, 3))
    );
    await test.ensure('other');
    accepted(await test.run((p) => p.changeHandle({ profileId: 'other' }, original.handle, 1)));
    const before = await test.ensure();
    expect(before.historicalHandles).toEqual([
      { ...released.historicalHandles[0], unavailableReason: 'claimed' },
    ]);
    expect(
      await test.run((p) => p.reactivateAlias(principal, original.handle, released.version))
    ).toMatchObject({ _tag: 'Rejected', reason: 'handle-unavailable' });
    expect(await test.ensure()).toEqual(before);
    expect(test.transitions.filter((t) => t.mutation.type === 'reactivate')).toHaveLength(0);
  });
  it('excludes expiring aliases from the retained limit immediately', async () => {
    at('2030-01-01T12:00:00.000Z');
    const test = controlledProfiles({ profileRetainedAliasLimit: 1 });
    const before = await test.ensure();
    await test.run((p) => p.changeHandle(principal, 'first', 1));
    at('2030-01-08T12:00:00.000Z');
    const scheduled = accepted(
      await test.run((p) => p.scheduleAliasExpiry(principal, before.handle, 2))
    );
    const updated = accepted(await test.run((p) => p.changeHandle(principal, 'second', 3)));
    expect(updated.aliases).toEqual([
      scheduled.aliases[0],
      {
        handle: 'first',
        claimGeneration: expect.any(Number),
        createdAt: '2030-01-08T12:00:00.000Z',
        expiresAt: null,
      },
    ]);
    expect(test.transitions.at(-1)?.mutation).toEqual({
      type: 'handle',
      handle: 'second',
      scheduledAliases: [],
    });
  });
  it('schedules all excess aliases in one version when the retained limit becomes zero', async () => {
    at('2030-01-01T12:00:00.000Z');
    const test = controlledProfiles();
    const before = await test.ensure();
    await test.run((p) => p.changeHandle(principal, 'first', 1));
    test.setPolicy({ profileRetainedAliasLimit: 0 });
    at('2030-01-08T12:00:00.000Z');
    const updated = accepted(await test.run((p) => p.changeHandle(principal, 'second', 2)));
    expect(updated).toMatchObject({ version: 3, retainedAliasLimit: 0 });
    expect(
      updated.aliases.map((alias) => ({ handle: alias.handle, expiresAt: alias.expiresAt }))
    ).toEqual([
      { handle: before.handle, expiresAt: '2030-01-09T12:00:00.000Z' },
      { handle: 'first', expiresAt: '2030-01-09T12:00:00.000Z' },
    ]);
    expect(test.transitions).toHaveLength(3);
  });
  it('retains a kept claim, releases it immediately, and creates a new generation on reactivation', async () => {
    const test = controlledProfiles();
    const before = await test.ensure();
    const changed = accepted(await test.run((p) => p.changeHandle(principal, 'second', 1)));
    const scheduled = accepted(
      await test.run((p) => p.scheduleAliasExpiry(principal, before.handle, 2))
    );
    const kept = accepted(await test.run((p) => p.reactivateAlias(principal, before.handle, 3)));
    expect(kept.aliases[0]).toMatchObject({
      claimGeneration: changed.aliases[0]?.claimGeneration,
      expiresAt: null,
    });
    expect(
      await test.run((p) =>
        p.expireDueAlias(
          {
            profileId: 'owner',
            handle: before.handle,
            claimGeneration: scheduled.aliases[0]!.claimGeneration,
          },
          new Date(scheduled.aliases[0]!.expiresAt!)
        )
      )
    ).toBe(false);
    expect(accepted(await test.run((p) => p.reactivateAlias(principal, before.handle, 4)))).toEqual(
      kept
    );
    await test.run((p) => p.scheduleAliasExpiry(principal, before.handle, 4));
    await test.run((p) => p.expireAliasImmediately(principal, before.handle, 5));
    const reactivated = accepted(
      await test.run((p) => p.reactivateAlias(principal, before.handle, 6))
    );
    expect(reactivated).toMatchObject({ version: 7, handle: 'second' });
    expect(reactivated.aliases[0]!.claimGeneration).toBeGreaterThan(
      changed.aliases[0]!.claimGeneration
    );
  });
});
