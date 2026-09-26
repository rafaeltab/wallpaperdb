import { readFileSync, readdirSync } from 'node:fs';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Effect, Layer, ManagedRuntime } from 'effect';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { databaseLayer } from '../src/adapters/database/index.js';
import { profileStoreLayer } from '../src/adapters/profiles/index.js';
import { Identities, Profiles, profilesLayer, type ProfilePolicy } from '../src/profile/index.js';

const policy: ProfilePolicy = {
  profileHandleMinLength: 1, profileHandleMaxLength: 20, profileDisplayNameMaxLength: 80,
  profileBiographyMaxLength: 5000, profileRetainedAliasLimit: 3, profileEvidenceRetentionDays: 30,
  profilePictureMaxBytes: 5242880, profilePictureMaxPixels: 16000000, profilePictureMaxDecodedBytes: 67108864,
};
const testLayer = (databaseUrl: string) => profilesLayer(policy).pipe(Layer.provide(Layer.mergeAll(
  profileStoreLayer(policy).pipe(Layer.provide(databaseLayer({ databaseUrl }))),
  Layer.succeed(Identities, { getIdentity: () => Effect.succeed({ displayName: 'Ada Lovelace', firstName: null, lastName: null, imageUrl: 'https://img.clerk.com/ada' }) }),
)));

describe('PostgreSQL profile transactions', () => {
  let database: StartedPostgreSqlContainer;
  let sql: ReturnType<typeof postgres>;
  let runtime: ManagedRuntime.ManagedRuntime<Profiles, unknown>;
  beforeAll(async () => {
    database = await new PostgreSqlContainer('postgres:16-alpine').start();
    const databaseUrl = database.getConnectionUri().replace('localhost', '127.0.0.1');
    sql = postgres(databaseUrl);
    const migrations = new URL('../drizzle/', import.meta.url);
    for (const name of readdirSync(migrations).filter(name => name.endsWith('.sql')).sort()) await sql.unsafe(readFileSync(new URL(name, migrations), 'utf8'));
    runtime = ManagedRuntime.make(testLayer(databaseUrl));
  });
  beforeEach(async () => { await sql`truncate table outbox_events, handle_claims, wallpaper_ownership, profiles cascade`; });
  afterAll(async () => { await runtime?.dispose(); await sql?.end(); await database?.stop(); });
  const run = <A, E>(use: (profiles: Profiles) => Effect.Effect<A, E>) => runtime.runPromise(Effect.gen(function* () { return yield* use(yield* Profiles); }));

  it('changes handles, schedules an alias, and refuses stale expiry after reactivation', async () => {
    await run(profiles => profiles.ensure({ profileId: 'owner' }));
    const changed = await run(profiles => profiles.changeHandle({ profileId: 'owner' }, 'Countess Ada', 1));
    expect(changed).toMatchObject({ _tag: 'Success', profile: { handle: 'countess-ada', version: 2, aliases: [{ handle: 'ada-lovelace', expiresAt: null }] } });
    const scheduled = await run(profiles => profiles.scheduleAliasExpiry({ profileId: 'owner' }, 'ADA-LOVELACE', 2));
    expect(scheduled).toMatchObject({ _tag: 'Success', profile: { version: 3, aliases: [{ handle: 'ada-lovelace', expiresAt: expect.any(String) }] } });
    const [claim] = await sql`select claim_generation from handle_claims where handle = 'ada-lovelace'`;
    expect(await run(profiles => profiles.reactivateAlias({ profileId: 'owner' }, 'ada-lovelace', 3))).toMatchObject({ _tag: 'Success', profile: { version: 4, aliases: [{ expiresAt: null }] } });
    expect(await run(profiles => profiles.expireDueAlias({ profileId: 'owner', handle: 'ada-lovelace', claimGeneration: Number(claim.claim_generation) }, new Date(Date.now() + 86400001)))).toBe(false);
    expect(await sql`select subject from outbox_events`).toHaveLength(4);
  });
  it('commits the winning details command with its event and rejects the stale concurrent writer', async () => {
    await run(profiles => profiles.ensure({ profileId: 'owner' }));
    const results = await Promise.all(['Grace Hopper', 'Katherine Johnson'].map(displayName => run(profiles => profiles.updateDetails({ profileId: 'owner' }, { displayName }, 1))));
    expect(results.filter(result => result._tag === 'Success')).toHaveLength(1);
    expect(results.filter(result => result._tag === 'Rejected')).toEqual([expect.objectContaining({ reason: 'version-conflict' })]);
    const [row] = await sql`select display_name, version from profiles where id = 'owner'`;
    expect(row.version).toBe(2);
    const updates = await sql`select payload from outbox_events where subject = 'profile.updated'`;
    expect(updates).toEqual([expect.objectContaining({ payload: expect.objectContaining({ change: { type: 'display-name-changed', before: 'Ada Lovelace', after: row.display_name }, profile: expect.objectContaining({ version: 2, displayName: row.display_name }) }) })]);
  });
  it('atomically creates one profile, claim, private import job and public event under concurrent ensure', async () => {
    const results = await Promise.all(Array.from({ length: 6 }, () => run(profiles => profiles.ensure({ profileId: 'owner' }))));
    expect(results).toEqual(Array(6).fill(expect.objectContaining({ _tag: 'Success', profile: expect.objectContaining({ id: 'owner', displayName: 'Ada Lovelace', handle: 'ada-lovelace', version: 1, pictureImportStatus: 'pending' }) })));
    const events = await sql`select subject, payload from outbox_events`;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ subject: 'profile.created', payload: { change: { type: 'created' }, profile: { id: 'owner', handle: 'ada-lovelace', claimGeneration: expect.any(Number), aliases: [], biographyMarkdown: '', pictureAssetId: null, version: 1 } } });
    expect(JSON.stringify(events)).not.toContain('img.clerk.com');
    expect(await sql`select handle, profile_id, kind from handle_claims`).toEqual([{ handle: 'ada-lovelace', profile_id: 'owner', kind: 'profile' }]);
    expect(await sql`select source_url from profile_picture_imports`).toEqual([{ source_url: 'https://img.clerk.com/ada' }]);
  });
});
