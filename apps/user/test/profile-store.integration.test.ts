import { inspect } from 'node:util';
import { readFileSync, readdirSync } from 'node:fs';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Effect, Layer, Logger, ManagedRuntime, Tracer } from 'effect';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { databaseLayer } from '../src/adapters/database/index.js';
import { profileStoreLayer } from '../src/adapters/profiles/index.js';
import {
  Identities,
  Profiles,
  ProfileStore,
  profilesLayer,
  type ProfilePolicy,
  type ProfileOutcome,
} from '../src/profile/index.js';

const policy: ProfilePolicy = {
  profileHandleMinLength: 1,
  profileHandleMaxLength: 20,
  profileDisplayNameMaxLength: 80,
  profileBiographyMaxLength: 5000,
  profileRetainedAliasLimit: 3,
  profileEvidenceRetentionDays: 30,
  profilePictureMaxBytes: 5242880,
  profilePictureMaxPixels: 16000000,
  profilePictureMaxDecodedBytes: 67108864,
};
const testLayer = (databaseUrl: string, settings: ProfilePolicy = policy) =>
  profilesLayer(settings).pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        profileStoreLayer(settings).pipe(Layer.provide(databaseLayer({ databaseUrl }))),
        Layer.succeed(Identities, {
          getIdentity: () =>
            Effect.succeed({
              displayName: 'Ada Lovelace',
              firstName: null,
              lastName: null,
              imageUrl: 'https://img.clerk.com/ada',
            }),
        })
      )
    )
  );

describe('PostgreSQL profile transactions', () => {
  let database: StartedPostgreSqlContainer;
  let sql: ReturnType<typeof postgres>;
  let runtime: ManagedRuntime.ManagedRuntime<Profiles | ProfileStore | Identities, unknown>;
  beforeAll(async () => {
    database = await new PostgreSqlContainer('postgres:16-alpine').start();
    const databaseUrl = database.getConnectionUri().replace('localhost', '127.0.0.1');
    sql = postgres(databaseUrl);
    const migrations = new URL('../drizzle/', import.meta.url);
    for (const name of readdirSync(migrations)
      .filter((name) => name.endsWith('.sql'))
      .sort())
      await sql.unsafe(readFileSync(new URL(name, migrations), 'utf8'));
    runtime = ManagedRuntime.make(testLayer(databaseUrl));
  });
  beforeEach(async () => {
    await sql`truncate table outbox_events, handle_claims, wallpaper_ownership, profiles cascade`;
  });
  afterAll(async () => {
    await runtime?.dispose();
    await sql?.end();
    await database?.stop();
  });
  const run = <A, E>(use: (profiles: Profiles) => Effect.Effect<A, E>) =>
    runtime.runPromise(
      Effect.gen(function* () {
        return yield* use(yield* Profiles);
      })
    );

  it('retains a removed picture for the configured seven days measured from retirement', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2030-01-01T12:00:00.000Z'));
    const custom = ManagedRuntime.make(
      testLayer(database.getConnectionUri().replace('localhost', '127.0.0.1'), {
        ...policy,
        profileEvidenceRetentionDays: 7,
      })
    );
    try {
      await custom.runPromise(Profiles.use((p) => p.ensure({ profileId: 'owner' })));
      await sql`insert into profile_picture_assets (id, profile_id, storage_bucket, storage_key, mime_type, width, height, file_size_bytes, state, expires_at) values ('retained-picture', 'owner', 'pictures', 'retained.webp', 'image/webp', 1, 1, 24, 'staged', '2030-01-03T12:00:00Z')`;
      expect(
        await custom.runPromise(
          Profiles.use((p) => p.adoptPicture({ profileId: 'owner' }, 'retained-picture', 1))
        )
      ).toMatchObject({
        _tag: 'Success',
        profile: { version: 2, pictureAssetId: 'retained-picture' },
      });
      vi.setSystemTime(new Date('2030-01-02T12:00:00.000Z'));
      expect(
        await custom.runPromise(
          Profiles.use((p) => p.adoptPicture({ profileId: 'owner' }, null, 2))
        )
      ).toMatchObject({ _tag: 'Success', profile: { version: 3, pictureAssetId: null } });
      expect(
        await sql`select state, expires_at from profile_picture_assets where id = 'retained-picture'`
      ).toEqual([{ state: 'retired', expires_at: new Date('2030-01-09T12:00:00.000Z') }]);
      const events =
        await sql`select payload from outbox_events where subject = 'profile.updated' order by created_at`;
      expect(events).toHaveLength(2);
      expect(events[1].payload).toMatchObject({
        profile: { version: 3, pictureAssetId: null },
        change: {
          type: 'picture-changed',
          before: 'retained-picture',
          after: null,
          asset: null,
          source: 'remove',
        },
      });
    } finally {
      await custom.dispose();
      vi.useRealTimers();
    }
  });
  it('does not disguise an unrelated unique constraint failure as a Handle collision', async () => {
    await sql.unsafe(
      `create function reject_outbox_identity() returns trigger language plpgsql as $$ begin raise exception using errcode = '23505', constraint = 'outbox_events_pkey', message = 'outbox identity collision'; end $$`
    );
    await sql.unsafe(
      `create trigger reject_outbox_identity before insert on outbox_events for each row execute function reject_outbox_identity()`
    );
    try {
      const creation = Effect.gen(function* () {
        return yield* (yield* ProfileStore).create({
          profileId: 'owner',
          displayName: 'Ada',
          handle: 'ada',
          imageUrl: null,
          now: new Date(),
        });
      });
      await expect(runtime.runPromise(creation)).rejects.toMatchObject({
        _tag: 'ProfileUnavailable',
        operation: 'create-profile',
        cause: { sqlState: '23505' },
      });
      expect(await sql`select id from profiles`).toEqual([]);
      expect(await sql`select handle from handle_claims`).toEqual([]);
    } finally {
      await sql.unsafe(
        'drop trigger reject_outbox_identity on outbox_events; drop function reject_outbox_identity()'
      );
    }
  });
  it('keeps a private import URL out of diagnostics when its database write fails', async () => {
    const marker = 'private-profile-source-marker';
    const logs: unknown[] = [];
    await sql.unsafe(
      `create function reject_private_import() returns trigger language plpgsql as $$ begin raise exception 'provider insert rejected for %', NEW.source_url; end $$`
    );
    await sql.unsafe(
      `create trigger reject_private_import before insert on profile_picture_imports for each row execute function reject_private_import()`
    );
    try {
      const result = await runtime.runPromise(
        Effect.gen(function* () {
          return yield* (yield* ProfileStore).create({
            profileId: 'owner',
            displayName: 'Ada',
            handle: 'ada',
            imageUrl: `https://img.clerk.com/picture?token=${marker}`,
            now: new Date(),
          });
        }).pipe(
          Effect.flip,
          Effect.provide(
            Logger.layer([
              Logger.make(({ message }) => {
                logs.push(message);
              }),
            ])
          )
        )
      );
      expect(logs).toHaveLength(1);
      expect(inspect(logs, { depth: null })).not.toContain(marker);
      expect(inspect(result.cause, { depth: null })).not.toContain(marker);
      expect(result).toMatchObject({
        _tag: 'ProfileUnavailable',
        operation: 'create-profile',
        cause: { sqlState: 'P0001' },
      });
      expect(await sql`select id from profiles`).toEqual([]);
    } finally {
      await sql.unsafe(
        'drop trigger reject_private_import on profile_picture_imports; drop function reject_private_import()'
      );
    }
  });
  it('rejects a picture that expires while its adoption waits for the owner lock', async () => {
    await run((profiles) => profiles.ensure({ profileId: 'owner' }));
    await sql`insert into profile_picture_assets (id, profile_id, storage_bucket, storage_key, mime_type, width, height, file_size_bytes, state, expires_at) values ('queued-picture', 'owner', 'pictures', 'queued.webp', 'image/webp', 1, 1, 24, 'staged', now() + interval '1 hour')`;
    let adoption: Promise<ProfileOutcome> | undefined;
    await sql.begin(async (tx) => {
      await tx`select id from profiles where id = 'owner' for update`;
      adoption = run((profiles) =>
        profiles.adoptPicture({ profileId: 'owner' }, 'queued-picture', 1)
      );
      await expect
        .poll(async () =>
          Number(
            (
              await sql`select count(*) from pg_stat_activity where application_name = 'wallpaperdb-user' and wait_event_type = 'Lock'`
            )[0].count
          )
        )
        .toBe(1);
      await tx`update profile_picture_assets set expires_at = clock_timestamp() where id = 'queued-picture'`;
    });
    if (!adoption) throw new Error('Adoption was not started');
    expect(await adoption).toMatchObject({ _tag: 'Rejected', reason: 'picture-unavailable' });
    expect(await sql`select picture_asset_id, version from profiles where id = 'owner'`).toEqual([
      { picture_asset_id: null, version: 1 },
    ]);
  });
  it('rolls back a defective domain decision without turning it into an expected technical failure', async () => {
    await run((profiles) => profiles.ensure({ profileId: 'owner' }));
    const defect = new Error('invalid decision implementation');
    const decision = Effect.gen(function* () {
      return yield* (yield* ProfileStore).transact({ profileId: 'owner', now: new Date() }, () => {
        throw defect;
      });
    }).pipe(Effect.catchTag('ProfileUnavailable', () => Effect.succeed('unexpected-conversion')));
    await expect(runtime.runPromise(decision)).rejects.toBe(defect);
    expect(await sql`select version from profiles where id = 'owner'`).toEqual([{ version: 1 }]);
    expect(await sql`select id from outbox_events`).toHaveLength(1);
  });
  it('records the originating trace with the durable outbox occurrence', async () => {
    await run((profiles) =>
      profiles.ensure({ profileId: 'owner' }).pipe(
        Effect.withParentSpan(
          Tracer.externalSpan({
            traceId: '12345678901234567890123456789012',
            spanId: '1234567890123456',
            sampled: true,
          })
        )
      )
    );
    const [event] = await sql`select trace_parent from outbox_events`;
    expect(event.trace_parent).toMatch(/^00-12345678901234567890123456789012-[0-9a-f]{16}-01$/);
  });
  it('supersedes an import lease when the owner removes a pending picture', async () => {
    await run((profiles) => profiles.ensure({ profileId: 'owner' }));
    await sql`update profile_picture_imports set lease_token = 'lease-1' where profile_id = 'owner'`;
    expect(
      await run((profiles) => profiles.adoptPicture({ profileId: 'owner' }, null, 1))
    ).toMatchObject({
      _tag: 'Success',
      profile: { version: 2, pictureImportStatus: 'complete', pictureAssetId: null },
    });
    expect(
      await run((profiles) =>
        profiles.adoptImportedPicture(
          { profileId: 'owner', leaseToken: 'lease-1' },
          'stale-picture'
        )
      )
    ).toMatchObject({ _tag: 'Success', profile: { version: 2, pictureAssetId: null } });
    expect(await sql`select source_url, lease_token, status from profile_picture_imports`).toEqual([
      { source_url: null, lease_token: null, status: 'complete' },
    ]);
    const updates = await sql`select payload from outbox_events where subject = 'profile.updated'`;
    expect(updates).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({
          change: {
            type: 'picture-changed',
            before: null,
            after: null,
            source: 'remove',
            asset: null,
          },
        }),
      }),
    ]);
  });
  it('changes handles, schedules an alias, and refuses stale expiry after reactivation', async () => {
    await run((profiles) => profiles.ensure({ profileId: 'owner' }));
    const changed = await run((profiles) =>
      profiles.changeHandle({ profileId: 'owner' }, 'Countess Ada', 1)
    );
    expect(changed).toMatchObject({
      _tag: 'Success',
      profile: {
        handle: 'countess-ada',
        version: 2,
        aliases: [{ handle: 'ada-lovelace', expiresAt: null }],
      },
    });
    const scheduled = await run((profiles) =>
      profiles.scheduleAliasExpiry({ profileId: 'owner' }, 'ADA-LOVELACE', 2)
    );
    expect(scheduled).toMatchObject({
      _tag: 'Success',
      profile: { version: 3, aliases: [{ handle: 'ada-lovelace', expiresAt: expect.any(String) }] },
    });
    const [claim] =
      await sql`select claim_generation from handle_claims where handle = 'ada-lovelace'`;
    expect(
      await run((profiles) => profiles.reactivateAlias({ profileId: 'owner' }, 'ada-lovelace', 3))
    ).toMatchObject({ _tag: 'Success', profile: { version: 4, aliases: [{ expiresAt: null }] } });
    expect(
      await run((profiles) =>
        profiles.expireDueAlias(
          {
            profileId: 'owner',
            handle: 'ada-lovelace',
            claimGeneration: Number(claim.claim_generation),
          },
          new Date(Date.now() + 86400001)
        )
      )
    ).toBe(false);
    expect(await sql`select subject from outbox_events`).toHaveLength(4);
  });
  it('commits the winning details command with its event and rejects the stale concurrent writer', async () => {
    await run((profiles) => profiles.ensure({ profileId: 'owner' }));
    const results = await Promise.all(
      ['Grace Hopper', 'Katherine Johnson'].map((displayName) =>
        run((profiles) => profiles.updateDetails({ profileId: 'owner' }, { displayName }, 1))
      )
    );
    expect(results.filter((result) => result._tag === 'Success')).toHaveLength(1);
    expect(results.filter((result) => result._tag === 'Rejected')).toEqual([
      expect.objectContaining({ reason: 'version-conflict' }),
    ]);
    const [row] = await sql`select display_name, version from profiles where id = 'owner'`;
    expect(row.version).toBe(2);
    const updates = await sql`select payload from outbox_events where subject = 'profile.updated'`;
    expect(updates).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({
          change: { type: 'display-name-changed', before: 'Ada Lovelace', after: row.display_name },
          profile: expect.objectContaining({ version: 2, displayName: row.display_name }),
        }),
      }),
    ]);
  });
  it('atomically creates one profile, claim, private import job and public event under concurrent ensure', async () => {
    const results = await Promise.all(
      Array.from({ length: 6 }, () => run((profiles) => profiles.ensure({ profileId: 'owner' })))
    );
    expect(results).toEqual(
      Array(6).fill(
        expect.objectContaining({
          _tag: 'Success',
          profile: expect.objectContaining({
            id: 'owner',
            displayName: 'Ada Lovelace',
            handle: 'ada-lovelace',
            version: 1,
            pictureImportStatus: 'pending',
          }),
        })
      )
    );
    const events = await sql`select subject, payload from outbox_events`;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      subject: 'profile.created',
      payload: {
        change: { type: 'created' },
        profile: {
          id: 'owner',
          handle: 'ada-lovelace',
          claimGeneration: expect.any(Number),
          aliases: [],
          biographyMarkdown: '',
          pictureAssetId: null,
          version: 1,
        },
      },
    });
    expect(JSON.stringify(events)).not.toContain('img.clerk.com');
    expect(await sql`select handle, profile_id, kind from handle_claims`).toEqual([
      { handle: 'ada-lovelace', profile_id: 'owner', kind: 'profile' },
    ]);
    expect(await sql`select source_url from profile_picture_imports`).toEqual([
      { source_url: 'https://img.clerk.com/ada' },
    ]);
  });
});
