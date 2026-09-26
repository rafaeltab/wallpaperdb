import { describe, expect, it } from 'vitest';
import { controlledProfiles } from './helpers/profiles.js';

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
});
