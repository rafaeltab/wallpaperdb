import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import postgres from 'postgres';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  Profiles,
  ProfileUnavailable,
  type ProfileOutcome,
  type ExternalIdentity,
  type AliasClaimReference,
} from '../src/profile/index.js';
import { Maintenance, ProfileEvents, maintenanceLayer } from '../src/maintenance/index.js';
import { databaseLayer } from '../src/adapters/database/index.js';
import { profileStoreLayer } from '../src/adapters/profiles/index.js';
import { eventStoreLayer } from '../src/adapters/events/index.js';
import {
  Identities,
  profilesLayer,
  type ProfilePolicy,
  type ProfileRejection,
} from '../src/profile/index.js';

const migrationDirectory = join(dirname(fileURLToPath(import.meta.url)), '../drizzle');
const migrationPaths = readdirSync(migrationDirectory)
  .filter((path) => path.endsWith('.sql'))
  .sort()
  .map((path) => join(migrationDirectory, path));

class FakeIdentityProvider implements Identities {
  readonly identities = new Map<string, ExternalIdentity>();
  error: Error | null = null;
  getIdentity(userId: string) {
    return Effect.suspend(() =>
      this.error
        ? Effect.fail(new ProfileUnavailable({ operation: 'identity-lookup', cause: this.error }))
        : Effect.succeed(
            this.identities.get(userId) ?? { displayName: null, firstName: null, lastName: null }
          )
    );
  }
}

describe('PostgreSQL Profile command contracts', () => {
  let postgresContainer: StartedPostgreSqlContainer;
  let sql: ReturnType<typeof postgres>;
  let runtime: ManagedRuntime.ManagedRuntime<Profiles | Maintenance, unknown>;
  const identities = new FakeIdentityProvider();
  let config: ProfilePolicy;
  let databaseUrl: string;

  beforeAll(async () => {
    postgresContainer = await new PostgreSqlContainer('postgres:16-alpine').start();
    databaseUrl = postgresContainer.getConnectionUri().replace('localhost', '127.0.0.1');
    sql = postgres(databaseUrl, { max: 10 });
    for (const migrationPath of migrationPaths) {
      await sql.unsafe(readFileSync(migrationPath, 'utf8'));
    }
    config = {
      profileHandleMinLength: 1,
      profileHandleMaxLength: 20,
      profileDisplayNameMaxLength: 80,
      profileBiographyMaxLength: 5000,
      profileRetainedAliasLimit: 3,
      profileEvidenceRetentionDays: 30,
      profilePictureMaxBytes: 5 * 1024 * 1024,
      profilePictureMaxPixels: 16_000_000,
      profilePictureMaxDecodedBytes: 64 * 1024 * 1024,
    };
    await reconfigure();
  });

  beforeEach(async () => {
    await sql`truncate table outbox_events, handle_claims, wallpaper_ownership, profiles cascade`;
    identities.identities.clear();
    identities.error = null;
  });

  afterAll(async () => {
    await runtime.dispose();
    await sql.end();
    await postgresContainer.stop();
  });

  async function reconfigure() {
    await runtime?.dispose();
    const database = databaseLayer({ databaseUrl });
    const profiles = profilesLayer({ ...config }).pipe(
      Layer.provide(
        Layer.mergeAll(
          profileStoreLayer({ ...config }).pipe(Layer.provide(database)),
          Layer.succeed(Identities, identities)
        )
      )
    );
    runtime = ManagedRuntime.make(
      maintenanceLayer({ retentionDays: config.profileEvidenceRetentionDays }).pipe(
        Layer.provideMerge(
          Layer.mergeAll(
            profiles,
            eventStoreLayer().pipe(Layer.provide(database)),
            Layer.succeed(ProfileEvents, {
              publish: () => Effect.die('Publication is outside this adapter contract'),
            })
          )
        )
      )
    );
  }

  const execute = <A, E>(use: (profiles: Profiles) => Effect.Effect<A, E>) =>
    runtime.runPromise(
      Effect.gen(function* () {
        return yield* use(yield* Profiles);
      })
    );
  const maintenance = <A, E>(use: (maintenance: Maintenance) => Effect.Effect<A, E>) =>
    runtime.runPromise(
      Effect.gen(function* () {
        return yield* use(yield* Maintenance);
      })
    );
  function expiry(value: string | null): Date {
    if (value === null) throw new Error('Expected a scheduled alias');
    return new Date(value);
  }
  function accepted(outcome: ProfileOutcome | ProfileUnavailable) {
    if (outcome._tag !== 'Success')
      throw new Error(`Expected successful Profile outcome, got ${outcome._tag}`);
    return outcome.profile;
  }
  function rejected(outcome: ProfileOutcome | ProfileUnavailable): ProfileRejection {
    if (outcome._tag !== 'Rejected')
      throw new Error(`Expected rejected Profile outcome, got ${outcome._tag}`);
    return outcome;
  }
  const command = (
    use: (profiles: Profiles) => Effect.Effect<ProfileOutcome, ProfileUnavailable>
  ) => execute((p) => use(p).pipe(Effect.catchTag('ProfileUnavailable', Effect.succeed)));
  function service() {
    return {
      ensure: (profileId: string) =>
        execute((profiles) => profiles.ensure({ profileId })).then(accepted),
      updateDisplayName: (profileId: string, displayName: string, version: number) =>
        execute((profiles) => profiles.updateDetails({ profileId }, { displayName }, version)).then(
          accepted
        ),
      expireDueAlias: (reference: AliasClaimReference, now: Date) =>
        execute((profiles) => profiles.expireDueAlias(reference, now)),
    };
  }

  const request = (profileId: string) => command((p) => p.ensure({ profileId }));
  const patch = (profileId: string, displayName: string, expectedVersion: number) =>
    command((p) => p.updateDetails({ profileId }, { displayName }, expectedVersion));
  const changeHandle = (profileId: string, handle: string, expectedVersion: number) =>
    command((p) => p.changeHandle({ profileId }, handle, expectedVersion));
  const scheduleAlias = (profileId: string, handle: string, expectedVersion: number) =>
    command((p) => p.scheduleAliasExpiry({ profileId }, handle, expectedVersion));
  const expireAlias = (profileId: string, handle: string, expectedVersion: number) =>
    command((p) => p.expireAliasImmediately({ profileId }, handle, expectedVersion));
  const reactivateAlias = (profileId: string, handle: string, expectedVersion: number) =>
    command((p) => p.reactivateAlias({ profileId }, handle, expectedVersion));

  it('rolls back both Profile details when the combined Biography event cannot commit', async () => {
    const original = accepted(await request('user_1'));
    await sql.unsafe(
      `create function reject_biography_event() returns trigger language plpgsql as $$ begin if NEW.payload->'change'->>'type' = 'profile-details-changed' then raise exception 'Biography event rejected'; end if; return NEW; end $$`
    );
    await sql.unsafe(
      `create trigger reject_biography_event before insert on outbox_events for each row execute function reject_biography_event()`
    );
    const save = () =>
      command((p) =>
        p.updateDetails(
          { profileId: original.id },
          { displayName: 'New Name', biographyMarkdown: 'New **Biography**' },
          original.version
        )
      );
    try {
      expect((await save())._tag).toBe('ProfileUnavailable');
      expect(accepted(await request('user_1'))).toEqual(original);
      expect(
        await sql`select id from outbox_events where subject = 'profile.updated'`
      ).toHaveLength(0);
      await sql.unsafe('drop trigger reject_biography_event on outbox_events');
      const saved = await save();
      expect(saved._tag).toBe('Success');
      expect(accepted(saved)).toMatchObject({
        displayName: 'New Name',
        biographyMarkdown: 'New **Biography**',
        version: original.version + 1,
      });
    } finally {
      await sql.unsafe('drop trigger if exists reject_biography_event on outbox_events');
      await sql.unsafe('drop function reject_biography_event()');
    }
  });

  it('audits a combined Display-name and Biography edit in one atomic Profile version', async () => {
    const original = accepted(await request('user_1'));
    const biographyMarkdown = 'A new **Biography**.';
    const response = await command((p) =>
      p.updateDetails(
        { profileId: original.id },
        { displayName: '  New Name  ', biographyMarkdown },
        original.version
      )
    );
    expect(response._tag).toBe('Success');
    const updated = accepted(response);
    expect(updated).toMatchObject({
      displayName: 'New Name',
      biographyMarkdown,
      version: original.version + 1,
    });
    const [event] = await sql`select payload from outbox_events where subject = 'profile.updated'`;
    expect(event.payload.change).toEqual({
      type: 'profile-details-changed',
      before: { displayName: original.displayName, biographyMarkdown: original.biographyMarkdown },
      after: { displayName: updated.displayName, biographyMarkdown },
    });
    expect(event.payload.profile).toMatchObject({
      displayName: 'New Name',
      biographyMarkdown,
      version: updated.version,
      aliases: updated.aliases,
    });
    expect(await sql`select id from outbox_events where subject = 'profile.updated'`).toHaveLength(
      1
    );
  });

  it('stores authored Biography Markdown and returns a complete authoritative versioned snapshot', async () => {
    const original = accepted(await request('user_1'));
    const authored = '  # Hello 👋\n\nA **Biography** with `<literal>` code.\n';
    const response = await command((p) =>
      p.updateDetails({ profileId: original.id }, { biographyMarkdown: authored }, original.version)
    );
    expect(response._tag).toBe('Success');
    const updated = accepted(response);
    expect(updated).toMatchObject({
      biographyMarkdown: authored,
      displayName: original.displayName,
      version: original.version + 1,
      biographyMaxLength: 5000,
      aliases: original.aliases,
    });
    expect(accepted(await request('user_1'))).toEqual(updated);
    const [event] =
      await sql`select payload, created_at from outbox_events where payload->'change'->>'type' = 'biography-changed'`;
    expect(event.created_at.toISOString()).toBe(event.payload.timestamp);
    expect(event.payload).toMatchObject({
      change: { type: 'biography-changed', before: '', after: authored },
      profile: {
        biographyMarkdown: authored,
        version: updated.version,
        aliases: updated.aliases,
        pictureAssetId: updated.pictureAssetId,
      },
    });
    expect(event.payload.profile).not.toHaveProperty('biographyHtml');
    expect(event.payload.profile).not.toHaveProperty('biographyMaxLength');
  });

  it('reactivates a released historical Handle with a new claim and authoritative event', async () => {
    const original = accepted(await request('user_1'));
    const changed = accepted(await changeHandle('user_1', 'current-handle', original.version));
    const scheduled = accepted(await scheduleAlias('user_1', original.handle, changed.version));
    const released = accepted(await expireAlias('user_1', original.handle, scheduled.version));
    const response = await reactivateAlias(
      'user_1',
      original.handle.toUpperCase(),
      released.version
    );
    expect(response._tag).toBe('Success');
    const reactivated = accepted(response);
    expect(reactivated).toMatchObject({
      handle: changed.handle,
      version: released.version + 1,
      lastHandleChangedAt: changed.lastHandleChangedAt,
      historicalHandles: [],
    });
    expect(reactivated.aliases).toEqual([
      {
        handle: original.handle,
        claimGeneration: expect.any(Number),
        createdAt: reactivated.updatedAt.toISOString(),
        expiresAt: null,
      },
    ]);
    expect(reactivated.aliases[0].claimGeneration).toBeGreaterThan(
      scheduled.aliases[0].claimGeneration
    );
    expect(accepted(await request('user_1'))).toEqual(reactivated);
    const [event] =
      await sql`select payload, created_at from outbox_events where payload->'change'->>'type' = 'alias-reactivated'`;
    expect(event.created_at.toISOString()).toBe(event.payload.timestamp);
    expect(event.payload).toMatchObject({
      change: {
        type: 'alias-reactivated',
        handle: original.handle,
        claimGeneration: reactivated.aliases[0].claimGeneration,
        before: null,
        after: null,
      },
      profile: {
        handle: changed.handle,
        version: reactivated.version,
        aliases: reactivated.aliases,
      },
    });
    expect(event.payload.profile).not.toHaveProperty('historicalHandles');
  });

  it('keeps an expiring alias with the same claim and defeats its stale expiry candidate', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2030-01-01T00:00:00.000Z'));
    try {
      const original = accepted(await request('user_1'));
      const changed = accepted(await changeHandle('user_1', 'current-handle', original.version));
      const scheduled = accepted(await scheduleAlias('user_1', original.handle, changed.version));
      const alias = scheduled.aliases[0];
      vi.setSystemTime(new Date('2030-01-01T01:00:00.000Z'));
      const response = await reactivateAlias('user_1', original.handle, scheduled.version);
      expect(response._tag).toBe('Success');
      const kept = accepted(response);
      expect(kept).toMatchObject({
        handle: changed.handle,
        lastHandleChangedAt: changed.lastHandleChangedAt,
        version: scheduled.version + 1,
        aliases: [{ ...alias, createdAt: '2030-01-01T01:00:00.000Z', expiresAt: null }],
        historicalHandles: [],
      });
      const [event] =
        await sql`select payload from outbox_events where payload->'change'->>'type' = 'alias-reactivated'`;
      expect(event.payload).toMatchObject({
        change: {
          type: 'alias-reactivated',
          handle: alias.handle,
          claimGeneration: alias.claimGeneration,
          before: alias.expiresAt,
          after: null,
        },
        profile: { aliases: kept.aliases, version: kept.version },
      });
      expect(accepted(await reactivateAlias('user_1', original.handle, kept.version))).toEqual(
        kept
      );
      expect((await reactivateAlias('user_1', original.handle, scheduled.version))._tag).toBe(
        'Rejected'
      );
      vi.setSystemTime(expiry(alias.expiresAt));
      expect(
        await service().expireDueAlias(
          { profileId: original.id, handle: alias.handle, claimGeneration: alias.claimGeneration },
          new Date()
        )
      ).toBe(false);
      expect(accepted(await request('user_1'))).toEqual(kept);
      expect(
        await sql`select id from outbox_events where payload->'change'->>'type' = 'alias-reactivated'`
      ).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses the configured evidence window for historical Handle eligibility even while events remain unpublished', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2030-01-01T00:00:00.000Z'));
    config = { ...config, profileEvidenceRetentionDays: 7 };
    await reconfigure();
    try {
      const original = accepted(await request('user_1'));
      const changed = accepted(await changeHandle('user_1', 'current-handle', original.version));
      const scheduled = accepted(await scheduleAlias('user_1', original.handle, changed.version));
      const released = accepted(await expireAlias('user_1', original.handle, scheduled.version));
      expect(released.historicalHandles).toEqual([
        {
          handle: original.handle,
          eligibleUntil: '2030-01-08T00:00:00.000Z',
          unavailableReason: null,
        },
      ]);
      vi.setSystemTime(new Date('2030-01-07T23:59:59.999Z'));
      expect(accepted(await request('user_1')).historicalHandles).toEqual(
        released.historicalHandles
      );
      vi.setSystemTime(new Date('2030-01-08T00:00:00.000Z'));
      expect(accepted(await request('user_1')).historicalHandles).toEqual([]);
      expect((await reactivateAlias('user_1', original.handle, released.version))._tag).toBe(
        'Rejected'
      );
      expect(
        (await sql`select id from outbox_events where published_at is null`).length
      ).toBeGreaterThan(0);
    } finally {
      config = { ...config, profileEvidenceRetentionDays: 30 };
      await reconfigure();
      vi.useRealTimers();
    }
  });

  it('ends history eligibility at exactly thirty days without renewing it from Display-name snapshots', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2030-01-01T00:00:00.000Z'));
    try {
      const original = accepted(await request('user_1'));
      const changed = accepted(await changeHandle('user_1', 'current-handle', original.version));
      const scheduled = accepted(await scheduleAlias('user_1', original.handle, changed.version));
      const released = accepted(await expireAlias('user_1', original.handle, scheduled.version));
      vi.setSystemTime(new Date('2030-01-30T00:00:00.000Z'));
      const renamed = accepted(await patch('user_1', 'invented-handle', released.version));
      expect(renamed.historicalHandles).toEqual(released.historicalHandles);
      const secondRename = accepted(await patch('user_1', 'another-invention', renamed.version));
      expect(secondRename.historicalHandles).toEqual(released.historicalHandles);
      for (const handle of ['invented-handle', 'another-invention', 'arbitrary-alias']) {
        const rejection = await reactivateAlias('user_1', handle, secondRename.version);
        expect(rejection._tag).toBe('Rejected');
        expect(rejected(rejection).reason).toContain('ineligible-handle');
      }
      const other = accepted(await request('user_2'));
      const wrongOwner = await reactivateAlias('user_2', original.handle, other.version);
      expect(wrongOwner._tag).toBe('Rejected');
      expect(rejected(wrongOwner).reason).toContain('ineligible-handle');
      vi.setSystemTime(new Date('2030-01-30T23:59:59.999Z'));
      expect(accepted(await request('user_1')).historicalHandles).toEqual(
        released.historicalHandles
      );
      vi.setSystemTime(new Date('2030-01-31T00:00:00.000Z'));
      const atDeadline = accepted(await request('user_1'));
      expect(atDeadline.historicalHandles).toEqual([]);
      const expiredHistory = await reactivateAlias('user_1', original.handle, secondRename.version);
      expect(expiredHistory._tag).toBe('Rejected');
      expect(rejected(expiredHistory).reason).toContain('ineligible-handle');
      expect(accepted(await request('user_1'))).toEqual(atDeadline);
      expect(
        await sql`select id from outbox_events where payload->'change'->>'type' = 'alias-reactivated'`
      ).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('renews an old alias only when a typed overflow schedule records that Handle', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2030-01-01T00:00:00.000Z'));
    const previousLimit = config.profileRetainedAliasLimit;
    config = { ...config, profileRetainedAliasLimit: 1 };
    await reconfigure();
    try {
      const original = accepted(await request('user_1'));
      const changed = accepted(await changeHandle('user_1', 'second-handle', original.version));
      vi.setSystemTime(new Date('2030-02-10T00:00:00.000Z'));
      const renamed = accepted(await patch('user_1', 'New Display Name', changed.version));
      expect((await reactivateAlias('user_1', original.handle, renamed.version))._tag).toBe(
        'Rejected'
      );
      const overflowed = accepted(await changeHandle('user_1', 'current-handle', renamed.version));
      expect(overflowed.historicalHandles).toEqual([
        {
          handle: original.handle,
          eligibleUntil: '2030-03-12T00:00:00.000Z',
          unavailableReason: 'alias-limit',
        },
      ]);
      expect(accepted(await request('user_1'))).toEqual(overflowed);
      const freed = accepted(await scheduleAlias('user_1', changed.handle, overflowed.version));
      const restored = await reactivateAlias('user_1', original.handle, freed.version);
      expect(restored._tag).toBe('Success');
      expect(
        accepted(restored).aliases.filter(
          (alias: { expiresAt: string | null }) => alias.expiresAt === null
        )
      ).toEqual([{ ...changed.aliases[0], createdAt: '2030-02-10T00:00:00.000Z' }]);
    } finally {
      config = { ...config, profileRetainedAliasLimit: previousLimit };
      await reconfigure();
      vi.useRealTimers();
    }
  });

  it('allows exactly one claimant when historical reactivation races a different Profile', async () => {
    const original = accepted(await request('user_1'));
    const changed = accepted(await changeHandle('user_1', 'current-handle', original.version));
    const scheduled = accepted(await scheduleAlias('user_1', original.handle, changed.version));
    const released = accepted(await expireAlias('user_1', original.handle, scheduled.version));
    const other = accepted(await request('user_2'));
    const [reactivation, competingClaim] = await Promise.all([
      reactivateAlias('user_1', original.handle, released.version),
      changeHandle('user_2', original.handle, other.version),
    ]);
    expect([reactivation._tag, competingClaim._tag].sort()).toEqual(['Rejected', 'Success']);
    const wonReactivation = reactivation._tag === 'Success';
    const claims =
      await sql`select profile_id, claim_generation from handle_claims where handle = ${original.handle}`;
    expect(claims).toHaveLength(1);
    expect(claims[0].profile_id).toBe(wonReactivation ? 'user_1' : 'user_2');
    expect(Number(claims[0].claim_generation)).toBeGreaterThan(
      scheduled.aliases[0].claimGeneration
    );
    const ownerAfter = accepted(await request('user_1'));
    expect(ownerAfter).toMatchObject({
      handle: changed.handle,
      version: released.version + Number(wonReactivation),
    });
    expect(ownerAfter.aliases).toHaveLength(Number(wonReactivation));
    const otherAfter = accepted(await request('user_2'));
    expect(otherAfter).toMatchObject({
      handle: wonReactivation ? other.handle : original.handle,
      version: other.version + Number(!wonReactivation),
    });
    expect(
      await sql`select id from outbox_events where payload->'change'->>'type' = 'alias-reactivated'`
    ).toHaveLength(Number(wonReactivation));
  });

  it('serializes keeping an alias against its due expiry with one accepted transition', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2030-01-01T00:00:00.000Z'));
    try {
      const original = accepted(await request('user_1'));
      const changed = accepted(await changeHandle('user_1', 'current-handle', original.version));
      const scheduled = accepted(await scheduleAlias('user_1', original.handle, changed.version));
      const alias = scheduled.aliases[0];
      const candidate = {
        profileId: original.id,
        handle: alias.handle,
        claimGeneration: alias.claimGeneration,
      };
      vi.setSystemTime(expiry(alias.expiresAt));
      const [keep, expired] = await Promise.all([
        reactivateAlias('user_1', original.handle, scheduled.version),
        service().expireDueAlias(candidate, new Date()),
      ]);
      expect(keep._tag).toBe(expired ? 'Rejected' : 'Success');
      const after = accepted(await request('user_1'));
      expect(after).toMatchObject({ handle: changed.handle, version: scheduled.version + 1 });
      expect(after.aliases).toEqual(
        expired ? [] : [{ ...alias, createdAt: alias.expiresAt, expiresAt: null }]
      );
      const transitions =
        await sql`select payload from outbox_events where payload->'change'->>'type' in ('alias-expired', 'alias-reactivated')`;
      expect(transitions).toHaveLength(1);
      expect(transitions[0].payload.change.type).toBe(
        expired ? 'alias-expired' : 'alias-reactivated'
      );
      expect(await service().expireDueAlias(candidate, new Date())).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    false,
    true,
  ])('rolls back reactivation claims and state when its event fails (released=%s)', async (released) => {
    const original = accepted(await request('user_1'));
    const changed = accepted(await changeHandle('user_1', 'current-handle', original.version));
    const scheduled = accepted(await scheduleAlias('user_1', original.handle, changed.version));
    const before = released
      ? accepted(await expireAlias('user_1', original.handle, scheduled.version))
      : scheduled;
    const claimsBefore =
      await sql`select * from handle_claims where profile_id = 'user_1' order by handle`;
    await sql.unsafe(
      `create function reject_reactivation_event() returns trigger language plpgsql as $$ begin if new.payload->'change'->>'type' = 'alias-reactivated' then raise exception 'reactivation event rejected'; end if; return new; end $$`
    );
    await sql.unsafe(
      'create trigger reject_reactivation_event before insert on outbox_events for each row execute function reject_reactivation_event()'
    );
    try {
      expect((await reactivateAlias('user_1', original.handle, before.version))._tag).toBe(
        'ProfileUnavailable'
      );
      expect(accepted(await request('user_1'))).toEqual(before);
      expect(
        await sql`select * from handle_claims where profile_id = 'user_1' order by handle`
      ).toEqual(claimsBefore);
      expect(
        await sql`select id from outbox_events where payload->'change'->>'type' = 'alias-reactivated'`
      ).toHaveLength(0);
    } finally {
      await sql.unsafe(
        'drop trigger reject_reactivation_event on outbox_events; drop function reject_reactivation_event()'
      );
    }
    const retried = await reactivateAlias('user_1', original.handle, before.version);
    expect(retried._tag).toBe('Success');
    expect(accepted(retried).version).toBe(before.version + 1);
    expect(
      await sql`select id from outbox_events where payload->'change'->>'type' = 'alias-reactivated'`
    ).toHaveLength(1);
  });

  it('returns recent typed Handle history after scheduling and expiry events commit', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2030-01-01T00:00:00.000Z'));
    try {
      const original = accepted(await request('user_1'));
      expect(original.historicalHandles).toEqual([]);
      const changed = accepted(await changeHandle('user_1', 'current-handle', original.version));
      expect(changed.historicalHandles).toEqual([]);
      vi.setSystemTime(new Date('2030-02-10T00:00:00.000Z'));
      const scheduled = accepted(await scheduleAlias('user_1', original.handle, changed.version));
      expect(scheduled.historicalHandles).toEqual([
        {
          handle: original.handle,
          eligibleUntil: '2030-03-12T00:00:00.000Z',
          unavailableReason: null,
        },
      ]);
      expect(accepted(await request('user_1'))).toEqual(scheduled);
      vi.setSystemTime(new Date('2030-02-11T00:00:00.000Z'));
      const expired = accepted(await expireAlias('user_1', original.handle, scheduled.version));
      expect(expired.historicalHandles).toEqual([
        {
          handle: original.handle,
          eligibleUntil: '2030-03-13T00:00:00.000Z',
          unavailableReason: null,
        },
      ]);
      expect(accepted(await request('user_1'))).toEqual(expired);
    } finally {
      vi.useRealTimers();
    }
  });

  it('releases a due alias at its exact expiry and permits a newer claim generation', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2030-01-01T12:00:00.000Z'));
    try {
      const original = accepted(await request('user_1'));
      const other = accepted(await request('user_2'));
      const changed = accepted(await changeHandle('user_1', 'current-handle', original.version));
      const scheduled = accepted(await scheduleAlias('user_1', original.handle, changed.version));
      const alias = scheduled.aliases[0];
      const candidate = {
        profileId: original.id,
        handle: alias.handle,
        claimGeneration: alias.claimGeneration,
      };
      const deadline = expiry(alias.expiresAt);
      expect(await service().expireDueAlias(candidate, new Date(deadline.getTime() - 1))).toBe(
        false
      );
      expect(accepted(await request('user_1'))).toEqual(scheduled);
      expect((await changeHandle('user_2', alias.handle, other.version))._tag).toBe('Rejected');
      vi.setSystemTime(deadline);
      expect(await service().expireDueAlias(candidate, deadline)).toBe(true);
      const expired = accepted(await request('user_1'));
      expect(expired).toMatchObject({
        handle: changed.handle,
        aliases: [],
        version: scheduled.version + 1,
      });
      const [event] =
        await sql`select payload from outbox_events where payload->'change'->>'type' = 'alias-expired'`;
      expect(event.payload).toMatchObject({
        timestamp: deadline.toISOString(),
        change: {
          type: 'alias-expired',
          handle: alias.handle,
          claimGeneration: alias.claimGeneration,
          before: alias.expiresAt,
          after: null,
          reason: 'scheduled',
        },
        profile: { aliases: [], version: expired.version },
      });
      expect(await service().expireDueAlias(candidate, deadline)).toBe(false);
      const reclaimed = await changeHandle('user_2', alias.handle, other.version);
      expect(reclaimed._tag).toBe('Success');
      const [claimEvent] =
        await sql`select payload from outbox_events where aggregate_id = 'user_2' and subject = 'profile.updated'`;
      expect(claimEvent.payload.profile.claimGeneration).toBeGreaterThan(alias.claimGeneration);
      expect(accepted(await request('user_1'))).toEqual({
        ...expired,
        historicalHandles: [{ ...expired.historicalHandles[0], unavailableReason: 'claimed' }],
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('expires due aliases through Maintenance with the PostgreSQL store', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2030-01-01T12:00:00.000Z'));
    try {
      const original = accepted(await request('user_1'));
      const changed = accepted(await changeHandle('user_1', 'current-handle', original.version));
      const scheduled = accepted(await scheduleAlias('user_1', original.handle, changed.version));
      const deadline = expiry(scheduled.aliases[0].expiresAt);
      vi.setSystemTime(new Date(deadline.getTime() - 1));
      await maintenance((service) => service.expireAliases(new Date()));
      expect(accepted(await request('user_1'))).toEqual(scheduled);
      vi.setSystemTime(deadline);
      await maintenance((service) => service.expireAliases(new Date()));
      const expired = accepted(await request('user_1'));
      expect(expired).toMatchObject({ aliases: [], version: scheduled.version + 1 });
      await maintenance((service) => service.expireAliases(new Date()));
      expect(accepted(await request('user_1'))).toEqual(expired);
      expect(
        await sql`select * from outbox_events where payload->'change'->>'type' = 'alias-expired'`
      ).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rolls back failed expiry events and retries them without blocking later due aliases', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2030-01-01T12:00:00.000Z'));
    try {
      identities.identities.set('user_bad', {
        displayName: 'A poison',
        firstName: null,
        lastName: null,
      });
      identities.identities.set('user_good', {
        displayName: 'Z healthy',
        firstName: null,
        lastName: null,
      });
      const owners = [];
      for (const id of ['user_bad', 'user_good']) {
        const original = accepted(await request(id));
        const changed = accepted(
          await changeHandle(id, `current-${id.replace('_', '-')}`, original.version)
        );
        owners.push(accepted(await scheduleAlias(id, original.handle, changed.version)));
      }
      const [bad, good] = owners;
      const other = accepted(await request('user_other'));
      await sql.unsafe(
        `create function reject_expiry_event() returns trigger language plpgsql as $$ begin if new.aggregate_id = 'user_bad' and new.payload->'change'->>'type' = 'alias-expired' then raise exception 'expiry event rejected'; end if; return new; end $$`
      );
      await sql.unsafe(
        `create trigger reject_expiry_event before insert on outbox_events for each row execute function reject_expiry_event()`
      );
      try {
        expect((await expireAlias(bad.id, bad.aliases[0].handle, bad.version))._tag).toBe(
          'ProfileUnavailable'
        );
        expect(accepted(await request(bad.id))).toEqual(bad);
        expect((await changeHandle(other.id, bad.aliases[0].handle, other.version))._tag).toBe(
          'Rejected'
        );
        vi.setSystemTime(expiry(bad.aliases[0].expiresAt));
        await maintenance((service) => service.expireAliases(new Date()));
        expect(accepted(await request(bad.id))).toEqual(bad);
        expect(accepted(await request(good.id))).toMatchObject({
          aliases: [],
          version: good.version + 1,
        });
        const events =
          await sql`select aggregate_id from outbox_events where payload->'change'->>'type' = 'alias-expired'`;
        expect(events.map((event) => event.aggregate_id)).toEqual([good.id]);
      } finally {
        await sql.unsafe(
          'drop trigger reject_expiry_event on outbox_events; drop function reject_expiry_event()'
        );
      }
      await maintenance((service) => service.expireAliases(new Date()));
      expect(accepted(await request(bad.id))).toMatchObject({
        aliases: [],
        version: bad.version + 1,
      });
      expect(
        await sql`select * from outbox_events where payload->'change'->>'type' = 'alias-expired'`
      ).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('safely races workers, immediate expiry, and a new Handle claimant', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2030-01-01T12:00:00.000Z'));
    try {
      const original = accepted(await request('user_1'));
      const other = accepted(await request('user_2'));
      const changed = accepted(await changeHandle('user_1', 'current-handle', original.version));
      const scheduled = accepted(await scheduleAlias('user_1', original.handle, changed.version));
      const reference = {
        profileId: original.id,
        handle: original.handle,
        claimGeneration: scheduled.aliases[0].claimGeneration,
      };
      vi.setSystemTime(expiry(scheduled.aliases[0].expiresAt));
      const worker = () => ({
        expirePending: () => maintenance((service) => service.expireAliases(new Date())),
      });
      const firstWorker = worker();
      const secondWorker = worker();
      const [, , , immediate, claim] = await Promise.all([
        firstWorker.expirePending(),
        firstWorker.expirePending(),
        secondWorker.expirePending(),
        expireAlias('user_1', original.handle, scheduled.version),
        changeHandle('user_2', original.handle, other.version),
      ]);
      expect(['Success', 'Rejected']).toContain(immediate._tag);
      expect(['Success', 'Rejected']).toContain(claim._tag);
      expect(accepted(await request('user_1'))).toMatchObject({
        aliases: [],
        version: scheduled.version + 1,
      });
      expect(
        await sql`select * from outbox_events where payload->'change'->>'type' = 'alias-expired'`
      ).toHaveLength(1);
      if (claim._tag === 'Rejected')
        expect((await changeHandle('user_2', original.handle, other.version))._tag).toBe('Success');
      const reclaimed = accepted(await request('user_2'));
      expect(reclaimed.handle).toBe(original.handle);
      expect(await service().expireDueAlias(reference, new Date())).toBe(false);
      expect(accepted(await request('user_2'))).toEqual(reclaimed);
      const [event] =
        await sql`select payload from outbox_events where aggregate_id = 'user_2' and subject = 'profile.updated'`;
      expect(event.payload.profile.claimGeneration).toBeGreaterThan(reference.claimGeneration);
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores an old expiry scan after the owner promotes and retains a newer claim for that Handle', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2030-01-01T12:00:00.000Z'));
    try {
      const original = accepted(await request('user_1'));
      const changed = accepted(await changeHandle('user_1', 'first-current', original.version));
      const scheduled = accepted(await scheduleAlias('user_1', original.handle, changed.version));
      const staleReference = {
        profileId: original.id,
        handle: original.handle,
        claimGeneration: scheduled.aliases[0].claimGeneration,
      };
      vi.setSystemTime(new Date('2030-01-08T12:00:00.000Z'));
      const promoted = await changeHandle('user_1', original.handle, scheduled.version);
      expect(promoted._tag).toBe('Success');
      expect(await service().expireDueAlias(staleReference, new Date())).toBe(false);
      vi.setSystemTime(new Date('2030-01-15T12:00:00.000Z'));
      const changedAgain = accepted(
        await changeHandle('user_1', 'second-current', accepted(promoted).version)
      );
      const scheduledAgain = accepted(
        await scheduleAlias('user_1', original.handle, changedAgain.version)
      );
      const newer = scheduledAgain.aliases.find(
        (alias: { handle: string }) => alias.handle === original.handle
      );
      if (!newer) throw new Error('Expected the retained alias after promotion');
      expect(newer.claimGeneration).toBeGreaterThan(staleReference.claimGeneration);
      vi.setSystemTime(expiry(newer.expiresAt));
      expect(await service().expireDueAlias(staleReference, new Date())).toBe(false);
      expect(accepted(await request('user_1'))).toEqual(scheduledAgain);
      expect(
        await service().expireDueAlias(
          { ...staleReference, claimGeneration: newer.claimGeneration },
          new Date()
        )
      ).toBe(true);
      const expired = accepted(await request('user_1'));
      expect(expired.aliases.map((alias: { handle: string }) => alias.handle)).toEqual([
        'first-current',
      ]);
      const [event] =
        await sql`select payload from outbox_events where payload->'change'->>'type' = 'alias-expired'`;
      expect(event.payload.change.claimGeneration).toBe(newer.claimGeneration);
    } finally {
      vi.useRealTimers();
    }
  });

  it('schedules a retained alias for exactly 24 hours and records its complete versioned snapshot', async () => {
    const before = accepted(await request('user_1'));
    const changed = accepted(await changeHandle('user_1', 'new-handle', before.version));
    const now = new Date('2030-01-01T12:00:00.000Z');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
    try {
      const response = await scheduleAlias('user_1', before.handle.toUpperCase(), changed.version);
      expect(response._tag).toBe('Success');
      const scheduled = accepted(response);
      const expiresAt = '2030-01-02T12:00:00.000Z';
      expect(scheduled).toMatchObject({
        handle: changed.handle,
        version: 3,
        lastHandleChangedAt: changed.lastHandleChangedAt,
        aliases: [{ ...changed.aliases[0], expiresAt }],
      });
      const events =
        await sql`select payload from outbox_events where payload->'change'->>'type' = 'alias-expiry-scheduled'`;
      expect(events).toHaveLength(1);
      expect(events[0].payload).toMatchObject({
        eventType: 'profile.updated',
        timestamp: now.toISOString(),
        change: {
          type: 'alias-expiry-scheduled',
          handle: before.handle,
          before: null,
          after: expiresAt,
        },
        profile: { handle: changed.handle, version: 3, aliases: scheduled.aliases },
      });
      const renamed = accepted(await patch('user_1', 'Renamed', scheduled.version));
      expect(renamed.aliases).toEqual(scheduled.aliases);
      expect(accepted(await request('user_1'))).toEqual(renamed);
    } finally {
      vi.useRealTimers();
    }
  });

  it('atomically schedules the deterministic oldest retained alias when changing at capacity', async () => {
    identities.identities.set('user_1', { displayName: 'Zulu', firstName: null, lastName: null });
    let owner = accepted(await request('user_1'));
    const week = 7 * 24 * 60 * 60 * 1000;
    const start = Date.parse('2030-01-01T12:00:00.000Z');
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      for (const [index, handle] of ['alpha', 'bravo', 'current'].entries()) {
        vi.setSystemTime(new Date(start + index * week));
        const response = await changeHandle('user_1', handle, owner.version);
        expect(response._tag).toBe('Success');
        owner = accepted(response);
      }
      expect(owner.aliases).toHaveLength(3);
      expect(
        owner.aliases.every((alias: { expiresAt: string | null }) => alias.expiresAt === null)
      ).toBe(true);
      // Existing claims can share retention timestamps; Handle breaks that tie.
      await sql`update handle_claims set created_at = '2030-01-01T12:00:00Z' where handle in ('zulu', 'alpha')`;
      const now = new Date(start + 3 * week);
      vi.setSystemTime(now);
      const response = await changeHandle('user_1', 'next-handle', owner.version);
      expect(response._tag).toBe('Success');
      const updated = accepted(response);
      const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
      expect(
        updated.aliases.filter((alias: { expiresAt: string | null }) => alias.expiresAt !== null)
      ).toEqual([
        {
          ...owner.aliases.find((alias: { handle: string }) => alias.handle === 'alpha'),
          createdAt: new Date(start).toISOString(),
          expiresAt,
        },
      ]);
      expect(
        updated.aliases.filter((alias: { expiresAt: string | null }) => alias.expiresAt === null)
      ).toHaveLength(3);
      expect(accepted(await request('user_1'))).toEqual(updated);
      const events =
        await sql`select payload from outbox_events where payload->'profile'->>'version' = ${String(updated.version)}`;
      expect(events).toHaveLength(1);
      expect(events[0].payload).toMatchObject({
        change: {
          type: 'handle-changed',
          before: 'current',
          after: 'next-handle',
          scheduledAliases: [{ handle: 'alpha', expiresAt }],
        },
        profile: { version: updated.version, aliases: updated.aliases },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('serializes scheduling against a Handle change at capacity with coherent owner reads', async () => {
    const start = Date.parse('2030-01-01T12:00:00.000Z');
    const week = 7 * 24 * 60 * 60 * 1000;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(start));
    try {
      let owner = accepted(await request('user_1'));
      for (const [index, handle] of ['first', 'second', 'current'].entries()) {
        vi.setSystemTime(new Date(start + index * week));
        owner = accepted(await changeHandle('user_1', handle, owner.version));
      }
      vi.setSystemTime(new Date(start + 3 * week));
      const [schedule, change, ...reads] = await Promise.all([
        scheduleAlias('user_1', owner.aliases[0].handle, owner.version),
        changeHandle('user_1', 'next', owner.version),
        ...Array.from({ length: 8 }, () => request('user_1')),
      ]);
      expect([schedule._tag, change._tag].sort()).toEqual(['Rejected', 'Success']);
      const winningProfile = accepted(schedule._tag === 'Success' ? schedule : change);
      const stale = rejected(schedule._tag === 'Rejected' ? schedule : change);
      expect(stale.reason).toBe('version-conflict');
      expect(winningProfile.version).toBe(owner.version + 1);
      expect(
        winningProfile.aliases.filter(
          (alias: { expiresAt: string | null }) => alias.expiresAt !== null
        )
      ).toHaveLength(1);
      for (const read of reads)
        expect(accepted(read)).toEqual(
          accepted(read).version === owner.version ? owner : winningProfile
        );
      expect(accepted(await request('user_1'))).toEqual(winningProfile);
      expect(
        await sql`select * from outbox_events where payload->'profile'->>'version' = ${String(winningProfile.version)}`
      ).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rolls back explicit and automatic scheduling when recording the Profile event fails', async () => {
    const previousLimit = config.profileRetainedAliasLimit;
    config = { ...config, profileRetainedAliasLimit: 1 };
    await reconfigure();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2030-01-01T12:00:00.000Z'));
    const initial = accepted(await request('user_1'));
    const owner = accepted(await changeHandle('user_1', 'current', initial.version));
    await sql.unsafe(
      `create function reject_alias_event() returns trigger language plpgsql as $$ begin if new.subject = 'profile.updated' then raise exception 'alias event rejected'; end if; return new; end $$`
    );
    await sql.unsafe(
      `create trigger reject_alias_event before insert on outbox_events for each row execute function reject_alias_event()`
    );
    try {
      expect((await scheduleAlias('user_1', initial.handle, owner.version))._tag).toBe(
        'ProfileUnavailable'
      );
      expect(accepted(await request('user_1'))).toEqual(owner);
      vi.setSystemTime(new Date('2030-01-08T12:00:00.000Z'));
      expect((await changeHandle('user_1', 'rollback-next', owner.version))._tag).toBe(
        'ProfileUnavailable'
      );
      expect(accepted(await request('user_1'))).toEqual(owner);
      expect(await sql`select * from handle_claims where handle = 'rollback-next'`).toHaveLength(0);
      expect(await sql`select * from outbox_events where subject = 'profile.updated'`).toHaveLength(
        1
      );
    } finally {
      await sql.unsafe(
        'drop trigger reject_alias_event on outbox_events; drop function reject_alias_event()'
      );
      config = { ...config, profileRetainedAliasLimit: previousLimit };
      await reconfigure();
      vi.useRealTimers();
    }
  });

  it('changes a Handle atomically and preserves the former Handle as an alias', async () => {
    identities.identities.set('user_1', { displayName: 'Before', firstName: null, lastName: null });
    const before = accepted(await request('user_1'));
    const response = await changeHandle('user_1', '  New__Hándle -- ', before.version);

    expect(response._tag).toBe('Success');
    expect(accepted(response)).toMatchObject({
      id: 'user_1',
      handle: 'new-handle',
      displayName: 'Before',
      version: 2,
      aliases: [{ handle: 'before', claimGeneration: expect.any(Number) }],
    });
    const events = await sql`select payload from outbox_events where subject = 'profile.updated'`;
    expect(events).toHaveLength(1);
    expect(events[0].payload).toMatchObject({
      eventType: 'profile.updated',
      change: { type: 'handle-changed', before: 'before', after: 'new-handle' },
      profile: {
        id: 'user_1',
        handle: 'new-handle',
        displayName: 'Before',
        version: 2,
        biographyMarkdown: '',
        pictureAssetId: null,
        aliases: accepted(response).aliases,
      },
    });
    expect(events[0].payload.profile.claimGeneration).toBeGreaterThan(
      accepted(response).aliases[0].claimGeneration
    );
    expect(accepted(await request('user_1'))).toMatchObject(accepted(response));
  });

  it('permits one concurrent claimant and reserves current Handles and aliases together', async () => {
    identities.identities.set('one', { displayName: 'First', firstName: null, lastName: null });
    identities.identities.set('two', { displayName: 'Second', firstName: null, lastName: null });
    const before = await Promise.all(['one', 'two'].map(async (id) => accepted(await request(id))));
    const responses = await Promise.all([
      changeHandle('one', 'same-handle', 1),
      changeHandle('two', ' SAME_HANDLE ', 1),
    ]);
    expect(responses.map((response) => response._tag).sort()).toEqual(['Rejected', 'Success']);
    const winnerIndex = responses.findIndex((response) => response._tag === 'Success');
    const loserIndex = 1 - winnerIndex;
    const winner = accepted(responses[winnerIndex]);
    const loser = before[loserIndex];
    expect(rejected(responses[loserIndex]).reason).toBe('handle-unavailable');
    expect(accepted(await request(loser.id))).toEqual(loser);
    const aliasCollision = await changeHandle(
      loser.id,
      before[winnerIndex].handle.toUpperCase(),
      1
    );
    expect(aliasCollision._tag).toBe('Rejected');
    expect(rejected(aliasCollision).reason).toBe('handle-unavailable');
    expect(accepted(await request(winner.id))).toEqual(winner);
    const events = await sql`select payload from outbox_events where subject = 'profile.updated'`;
    expect(events).toHaveLength(1);
    expect(events[0].payload.profile.claimGeneration).toBeGreaterThan(
      winner.aliases[0].claimGeneration
    );
    identities.identities.set('three', {
      displayName: before[winnerIndex].handle,
      firstName: null,
      lastName: null,
    });
    const allocated = accepted(await request('three'));
    expect(allocated.handle).not.toBe(before[winnerIndex].handle);
  });

  it('preserves aliases in owner responses and complete snapshots after Display-name edits', async () => {
    const before = accepted(await request('user_1'));
    const changed = accepted(await changeHandle('user_1', 'new-handle', before.version));
    const edited = await patch('user_1', 'New Display', changed.version);
    expect(edited._tag).toBe('Success');
    expect(accepted(edited)).toMatchObject({
      aliases: changed.aliases,
      lastHandleChangedAt: changed.lastHandleChangedAt,
      displayName: 'New Display',
      version: 3,
    });
    const events =
      await sql`select payload from outbox_events where subject = 'profile.updated' order by created_at, id`;
    expect(events[1].payload.profile).toMatchObject({
      aliases: changed.aliases,
      handle: changed.handle,
      displayName: 'New Display',
      version: 3,
    });
    expect(accepted(await patch('user_1', 'New Display', 3))).toEqual(accepted(edited));
    expect(accepted(await request('user_1'))).toEqual(accepted(edited));
  });

  it('can promote its own retained alias with a new generation after cooldown', async () => {
    const before = accepted(await request('user_1'));
    vi.useFakeTimers({ toFake: ['Date'] });
    const now = new Date('2030-01-01T12:00:00.000Z');
    vi.setSystemTime(now);
    try {
      const changed = accepted(await changeHandle('user_1', 'new-handle', before.version));
      vi.setSystemTime(new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000));
      const reverted = await changeHandle('user_1', before.handle, changed.version);
      expect(reverted._tag).toBe('Success');
      expect(accepted(reverted)).toMatchObject({
        handle: before.handle,
        version: 3,
        aliases: [{ handle: 'new-handle', claimGeneration: expect.any(Number) }],
      });
      const events =
        await sql`select payload from outbox_events where subject = 'profile.updated' order by created_at, id`;
      expect(events[1].payload.profile.claimGeneration).toBeGreaterThan(
        events[0].payload.profile.claimGeneration
      );
      expect(events[1].payload.change).toEqual({
        type: 'handle-changed',
        before: 'new-handle',
        after: before.handle,
        scheduledAliases: [],
      });
      expect(accepted(await request('user_1'))).toEqual(accepted(reverted));
    } finally {
      vi.useRealTimers();
    }
  });

  it('rolls back the Handle, cooldown, and claims when recording the transition fails', async () => {
    const before = accepted(await request('user_1'));
    await sql.unsafe(
      `create function reject_handle_event() returns trigger language plpgsql as $$ begin if new.subject = 'profile.updated' then raise exception 'handle event rejected'; end if; return new; end $$`
    );
    await sql.unsafe(
      'create trigger reject_handle_event before insert on outbox_events for each row execute function reject_handle_event()'
    );
    try {
      const failed = await changeHandle('user_1', 'new-handle', before.version);
      expect(failed._tag).toBe('ProfileUnavailable');
      expect(accepted(await request('user_1'))).toEqual(before);
      expect(await sql`select * from outbox_events where subject = 'profile.updated'`).toHaveLength(
        0
      );
    } finally {
      await sql.unsafe(
        'drop trigger reject_handle_event on outbox_events; drop function reject_handle_event()'
      );
    }
    const retriedChange = await changeHandle('user_1', 'new-handle', before.version);
    expect(retriedChange._tag).toBe('Success');
    expect(accepted(retriedChange)).toMatchObject({
      version: 2,
      aliases: [{ handle: before.handle, claimGeneration: expect.any(Number) }],
    });
  });

  it('serializes competing Handle edits and returns coherent owner snapshots', async () => {
    const before = accepted(await request('user_1'));
    const [first, second, ...reads] = await Promise.all([
      changeHandle('user_1', 'first-handle', before.version),
      changeHandle('user_1', 'second-handle', before.version),
      ...Array.from({ length: 8 }, () => request('user_1')),
    ]);
    expect([first._tag, second._tag].sort()).toEqual(['Rejected', 'Success']);
    const stale = first._tag === 'Rejected' ? first : second;
    expect(rejected(stale).reason).toBe('version-conflict');
    for (const response of reads) {
      expect(response._tag).toBe('Success');
      const profile = accepted(response);
      if (profile.version === 1) expect(profile).toEqual(before);
      else
        expect(profile).toMatchObject({
          version: 2,
          handle: expect.stringMatching(/^(first|second)-handle$/),
          aliases: [{ handle: before.handle, claimGeneration: expect.any(Number) }],
        });
    }
    expect(await sql`select * from outbox_events where subject = 'profile.updated'`).toHaveLength(
      1
    );
  });

  it('normalizes Unicode whitespace and records an atomic Display-name change', async () => {
    identities.identities.set('user_1', { displayName: 'Before', firstName: null, lastName: null });
    await service().ensure('user_1');

    const response = await patch('user_1', '  Éowyn\t雪\nQueen  ', 1);

    expect(response._tag).toBe('Success');
    expect(accepted(response)).toMatchObject({
      id: 'user_1',
      displayName: 'Éowyn 雪 Queen',
      version: 2,
    });
    const rows = await sql`select subject, payload from outbox_events order by created_at, id`;
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({
      subject: 'profile.updated',
      payload: {
        eventType: 'profile.updated',
        change: { type: 'display-name-changed', before: 'Before', after: 'Éowyn 雪 Queen' },
        profile: { displayName: 'Éowyn 雪 Queen', version: 2 },
      },
    });
  });

  it('allows only one of two concurrent edits at the last-seen version', async () => {
    identities.identities.set('user_1', { displayName: 'Before', firstName: null, lastName: null });
    await service().ensure('user_1');

    const responses = await Promise.all([
      patch('user_1', 'First edit', 1),
      patch('user_1', 'Second edit', 1),
    ]);

    expect(responses.map((response) => response._tag).sort()).toEqual(['Rejected', 'Success']);
    const [stored] = await sql`select display_name, version from profiles where id = 'user_1'`;
    expect(stored.version).toBe(2);
    expect(['First edit', 'Second edit']).toContain(stored.display_name);
    expect((await sql`select * from outbox_events where subject = 'profile.updated'`).length).toBe(
      1
    );
  });

  it('rolls back the Display name and version when recording its event fails', async () => {
    identities.identities.set('user_1', { displayName: 'Before', firstName: null, lastName: null });
    await service().ensure('user_1');
    await sql.unsafe(
      `create function reject_update_event() returns trigger language plpgsql as $$ begin if new.subject = 'profile.updated' then raise exception 'update event rejected'; end if; return new; end $$`
    );
    await sql.unsafe(
      `create trigger reject_update_event before insert on outbox_events for each row execute function reject_update_event()`
    );

    try {
      await expect(service().updateDisplayName('user_1', 'After', 1)).rejects.toMatchObject({
        _tag: 'ProfileUnavailable',
        operation: 'transition-profile',
      });
      expect(
        (await sql`select display_name, version from profiles where id = 'user_1'`)[0]
      ).toMatchObject({
        display_name: 'Before',
        version: 1,
      });
    } finally {
      await sql.unsafe(
        'drop trigger reject_update_event on outbox_events; drop function reject_update_event()'
      );
    }
  });

  it('claims collision suffixes atomically for different users', async () => {
    for (const id of ['one', 'two']) {
      identities.identities.set(id, { displayName: 'Same Name', firstName: null, lastName: null });
    }
    const results = await Promise.all([service().ensure('one'), service().ensure('two')]);
    const handles = results.map((profile) => profile.handle);
    expect(new Set(handles).size).toBe(2);
    expect(handles).toContain('same-name');
    expect(handles.find((handle) => handle !== 'same-name')).toMatch(/^same-name-[a-z0-9]{6}$/);
    const claims = await sql`select claim_generation from handle_claims order by claim_generation`;
    expect(Number(claims[1].claim_generation)).toBeGreaterThan(Number(claims[0].claim_generation));
  });

  it('is idempotent under concurrent ensures for the same user', async () => {
    identities.identities.set('same', {
      displayName: 'Concurrent',
      firstName: null,
      lastName: null,
    });
    const results = await Promise.all(Array.from({ length: 8 }, () => service().ensure('same')));
    expect(new Set(results.map((profile) => profile.id))).toEqual(new Set(['same']));
    expect((await sql`select * from profiles`).length).toBe(1);
    expect((await sql`select * from outbox_events`).length).toBe(1);
  });

  it('rolls back profile and handle writes when the outbox write fails', async () => {
    identities.identities.set('user_1', {
      displayName: 'Rollback',
      firstName: null,
      lastName: null,
    });
    await sql.unsafe(
      `create function reject_outbox() returns trigger language plpgsql as $$ begin raise exception 'outbox rejected'; end $$`
    );
    await sql.unsafe(
      `create trigger reject_outbox before insert on outbox_events for each row execute function reject_outbox()`
    );
    try {
      await expect(service().ensure('user_1')).rejects.toMatchObject({
        _tag: 'ProfileUnavailable',
        operation: 'create-profile',
      });
      expect((await sql`select * from profiles`).length).toBe(0);
      expect((await sql`select * from handle_claims`).length).toBe(0);
    } finally {
      await sql.unsafe(
        'drop trigger reject_outbox on outbox_events; drop function reject_outbox()'
      );
    }
  });
});
