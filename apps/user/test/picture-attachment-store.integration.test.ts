import { readFileSync, readdirSync } from 'node:fs';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Effect, Layer, ManagedRuntime } from 'effect';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  Identities,
  Profiles,
  ProfileStore,
  profilesLayer,
} from '../src/capabilities/profile/index.js';
import { profileStoreLayer } from '../src/adapters/profiles/index.js';
import { runAttachmentOperator } from '../scripts/attachment-operator.js';
import { profilePolicy } from './helpers/profiles.js';
import { databaseLayer } from '../src/adapters/database/index.js';
import { attachmentPostgresLayer } from '../src/adapters/picture-attachments/store.js';
import {
  AttachmentDelivery,
  PictureAttachments,
  pictureAttachmentsLayer,
  type PictureAttachment,
  type AttachmentPublication,
} from '../src/capabilities/picture-attachments/index.js';
describe('PostgreSQL picture attachment contract', () => {
  let container: StartedPostgreSqlContainer;
  let sql: ReturnType<typeof postgres>;
  let runtime: ManagedRuntime.ManagedRuntime<PictureAttachments | AttachmentDelivery, unknown>;
  let databaseUrl: string;
  const layer = () => {
    const store = attachmentPostgresLayer({ maxAttempts: 2, retryDelayMs: 1, leaseMs: 1000 }).pipe(
      Layer.provide(databaseLayer({ databaseUrl }))
    );
    return pictureAttachmentsLayer.pipe(Layer.provideMerge(store));
  };
  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    databaseUrl = container.getConnectionUri().replace('localhost', '127.0.0.1');
    sql = postgres(databaseUrl);
    const migrations = new URL('../drizzle/', import.meta.url);
    for (const name of readdirSync(migrations)
      .filter((n) => n.endsWith('.sql'))
      .sort())
      await sql.unsafe(readFileSync(new URL(name, migrations), 'utf8'));
    runtime = ManagedRuntime.make(layer());
  });
  beforeEach(async () => {
    await sql`truncate profiles,handle_claims,outbox_events cascade`;
    await sql`truncate picture_attachment_quarantine`;
    await sql`insert into profiles(id,display_name,handle) values ('owner','Owner','owner')`;
    await sql`insert into handle_claims(handle,profile_id,kind) values ('owner','owner','profile')`;
  });
  afterAll(async () => {
    await runtime?.dispose();
    await sql?.end();
    await container?.stop();
  });
  const begin = async (key = 'first', expectedVersion = 1) => {
    const result = await runtime.runPromise(
      PictureAttachments.use((s) => s.begin({ profileId: 'owner' }, key, expectedVersion))
    );
    if (result.kind !== 'attachment') throw new Error(result.kind);
    return result.attachment;
  };
  const created = (i: PictureAttachment, assetId = 'asset-A') =>
    runtime.runPromise(
      PictureAttachments.use((s) =>
        s.assetResult({
          attachmentId: i.id,
          commandId: i.commandId,
          causationId: i.creationEventId,
          outcome: 'created',
          assetId,
        })
      )
    );
  const confirm = (i: PictureAttachment) =>
    runtime.runPromise(
      PictureAttachments.use((s) =>
        s.sourceAccepted({
          assetId: i.assetId ?? 'asset-A',
          candidateId: 'candidate-A',
          intentId: 'edit-A',
          sourceId: 'source-A',
          defaultSourceId: 'source-A',
          initialAnalysisSourceId: 'source-A',
          occurrenceId: 'accepted-A',
        })
      )
    );
  const register = (i: PictureAttachment) =>
    runtime.runPromise(
      PictureAttachments.use((s) =>
        s.expectSource({ profileId: 'owner' }, i.id, {
          candidateId: 'candidate-A',
          intentId: 'edit-A',
        })
      )
    );
  const remove = async (expectedVersion: number) => {
    const owner = ManagedRuntime.make(
      profilesLayer(profilePolicy).pipe(
        Layer.provide(
          Layer.merge(
            profileStoreLayer(profilePolicy).pipe(Layer.provide(databaseLayer({ databaseUrl }))),
            Layer.succeed(Identities, {
              getIdentity: () => Effect.die('Unexpected identity lookup'),
            })
          )
        )
      )
    );
    try {
      return await owner.runPromise(
        Profiles.use((p) => p.adoptPicture({ profileId: 'owner' }, null, expectedVersion))
      );
    } finally {
      await owner.dispose();
    }
  };
  const sourceConfirmation = () => ({
    specversion: '1.0',
    id: 'accepted-A',
    source: 'https://wallpaperdb/asset',
    type: 'asset.source.accepted',
    time: '2026-10-23T00:00:00.000Z',
    datacontenttype: 'application/json',
    causationsource: 'https://wallpaperdb/asset/authors',
    causationid: 'accept-A',
    correlationid: 'edit-A',
    data: {
      assetId: 'asset-A',
      assetType: 'picture',
      candidateId: 'candidate-A',
      sourceId: 'source-A',
      defaultSourceId: 'source-A',
      initialAnalysisSourceId: 'source-A',
      sourceSetRevision: '1',
      deliveryRevision: '1',
    },
  });
  const creationConfirmation = (i: PictureAttachment) =>
    JSON.stringify({
      ...sourceConfirmation(),
      type: 'asset.command.result',
      causationsource: 'https://wallpaperdb/user',
      causationid: i.creationEventId,
      data: {
        commandId: i.commandId,
        applicationReference: i.id,
        outcome: 'created',
        assetId: 'asset-A',
      },
    });
  const status = (i: PictureAttachment) =>
    runtime.runPromise(PictureAttachments.use((s) => s.get({ profileId: 'owner' }, i.id)));
  const claimPublication = async (id: string) => {
    const publication = (await runtime.runPromise(AttachmentDelivery.use((d) => d.claim()))).find(
      (p) => p.id === id
    );
    if (!publication) throw new Error(`Missing publication ${id}`);
    return publication;
  };
  const exhaustPublication = async (id: string) => {
    const first = await claimPublication(id);
    await runtime.runPromise(AttachmentDelivery.use((d) => d.failed(first)));
    await sql`update picture_attachment_outbox set available_at=now()-interval '1 second' where id=${id}`;
    const second = await claimPublication(id);
    await runtime.runPromise(AttachmentDelivery.use((d) => d.failed(second)));
    return first;
  };
  it.each([
    'pending',
    'quarantined',
  ])('ignores an earlier notification acknowledgement while renewed work is %s', async (phase) => {
    const i = await begin();
    await exhaustPublication(i.creationEventId);
    const [alert] = await runtime.runPromise(AttachmentDelivery.use((d) => d.alerts()));
    if (!alert) throw new Error('Missing exhausted publication alert');
    const stale: Parameters<AttachmentDelivery['alerted']> = [
      alert.id,
      alert.scope,
      alert.quarantineId,
    ];
    await runtime.runPromise(AttachmentDelivery.use((d) => d.alerted(...stale)));
    expect(await runtime.runPromise(AttachmentDelivery.use((d) => d.recover(alert.id)))).toBe(true);
    if (phase === 'quarantined') await exhaustPublication(i.creationEventId);
    await runtime.runPromise(AttachmentDelivery.use((d) => d.alerted(...stale)));
    if (phase === 'pending') await exhaustPublication(i.creationEventId);
    expect(await runtime.runPromise(AttachmentDelivery.use((d) => d.alerts()))).toHaveLength(1);
    expect(await status(i)).toMatchObject({ attachment: { attentionRequired: true } });
  });
  it('leaves a recovered confirmation closed when its delayed notification acknowledgement arrives', async () => {
    const i = await begin();
    await created(i);
    await runtime.runPromise(
      AttachmentDelivery.use((d) =>
        d.quarantine('recovered-ack', creationConfirmation(i), 'confirmation-exhausted', {
          kind: 'intent',
          id: i.id,
        })
      )
    );
    const [alert] = await runtime.runPromise(AttachmentDelivery.use((d) => d.alerts()));
    if (!alert) throw new Error('Missing confirmation alert');
    expect(
      await runAttachmentOperator(['recover-confirmation', alert.id], {
        databaseUrl,
        maxAttempts: 2,
        retryDelayMs: 1,
      })
    ).toEqual({ recovered: true });
    await runtime.runPromise(
      AttachmentDelivery.use((d) => d.alerted(alert.id, alert.scope, alert.quarantineId))
    );
    expect(
      await sql`select notified_at from picture_attachment_quarantine where id=${alert.id}`
    ).toEqual([{ notified_at: null }]);
    expect(await runtime.runPromise(AttachmentDelivery.use((d) => d.alerts()))).toEqual([]);
    expect(await status(i)).toMatchObject({
      attachment: { attentionRequired: false, state: 'awaiting-source' },
    });
  });
  it('rolls back occurrence renewal and attempt reset together when recovery cannot commit', async () => {
    const i = await begin();
    await exhaustPublication(i.creationEventId);
    const before = await runtime.runPromise(AttachmentDelivery.use((d) => d.alerts()));
    await sql`alter table picture_attachment_outbox add constraint reject_recovery check (status != 'pending')`;
    try {
      await expect(
        runAttachmentOperator(['recover-outbox', i.creationEventId], {
          databaseUrl,
          maxAttempts: 2,
          retryDelayMs: 1,
        })
      ).rejects.toThrow();
    } finally {
      await sql`alter table picture_attachment_outbox drop constraint reject_recovery`;
    }
    expect(await runtime.runPromise(AttachmentDelivery.use((d) => d.alerts()))).toEqual(before);
    expect(await runtime.runPromise(AttachmentDelivery.use((d) => d.claim()))).toEqual([]);
    expect(await status(i)).toMatchObject({ attachment: { attentionRequired: true } });
    expect(
      await runAttachmentOperator(['recover-outbox', i.creationEventId], {
        databaseUrl,
        maxAttempts: 2,
        retryDelayMs: 1,
      })
    ).toEqual({ recovered: true });
    const first = await claimPublication(i.creationEventId);
    expect(first.attempts).toBe(0);
    await runtime.runPromise(AttachmentDelivery.use((d) => d.failed(first)));
    await sql`update picture_attachment_outbox set available_at=now()-interval '1 second' where id=${i.creationEventId}`;
    const second = await claimPublication(i.creationEventId);
    expect(second.attempts).toBe(1);
    expect(second.event).toEqual(first.event);
    await runtime.runPromise(AttachmentDelivery.use((d) => d.failed(second)));
    const renewed = await runtime.runPromise(AttachmentDelivery.use((d) => d.alerts()));
    expect(renewed).toHaveLength(1);
    expect(renewed).not.toEqual(before);
    expect(await runtime.runPromise(AttachmentDelivery.use((d) => d.claim()))).toEqual([]);
  });
  it.each([
    ['creation', 'creation-outbox'],
    ['rejected-creation', 'creation-outbox'],
    ['source', 'creation-outbox'],
    ['source', 'confirmation'],
    ['deletion', 'creation-outbox'],
    ['deletion', 'deletion-outbox'],
    ['deletion', 'confirmation'],
  ])('preserves %s progress and independent %s attention until that duty actually closes', async (transition, duty) => {
    const i = await begin();
    if (!transition.includes('creation')) await created(i);
    if (transition === 'source') await register(i);
    if (transition === 'deletion')
      await runtime.runPromise(
        PictureAttachments.use((s) => s.cancel({ profileId: 'owner' }, i.id))
      );
    const publicationId = duty === 'deletion-outbox' ? i.deletionEventId : i.creationEventId;
    let original: AttachmentPublication | undefined;
    if (duty === 'confirmation')
      await runtime.runPromise(
        AttachmentDelivery.use((d) =>
          d.quarantine('retained-create', creationConfirmation(i), 'confirmation-exhausted', {
            kind: 'intent',
            id: i.id,
          })
        )
      );
    else original = await exhaustPublication(publicationId);
    expect(await status(i)).toMatchObject({ attachment: { attentionRequired: true } });
    expect(
      transition === 'source'
        ? await confirm(i)
        : transition === 'creation'
          ? await created(i)
          : await runtime.runPromise(
              PictureAttachments.use((s) =>
                s.assetResult({
                  attachmentId: i.id,
                  commandId: transition === 'deletion' ? i.deleteCommandId : i.commandId,
                  causationId: transition === 'deletion' ? i.deletionEventId : i.creationEventId,
                  outcome: transition === 'deletion' ? 'deleted' : 'rejected',
                  assetId: transition === 'deletion' ? 'asset-A' : null,
                })
              )
            )
    ).toBe('applied');
    const completed = {
      state:
        transition === 'source'
          ? 'attached'
          : transition === 'deletion'
            ? 'cancelled'
            : transition === 'rejected-creation'
              ? 'failed'
              : 'awaiting-source',
      ...(transition === 'deletion' ? { deletion: 'complete' } : {}),
    };
    expect(await status(i)).toMatchObject({
      attachment: { ...completed, attentionRequired: true },
    });
    const alerts = await runtime.runPromise(AttachmentDelivery.use((d) => d.alerts()));
    const alert = alerts.find(
      (a) => a.scope === (duty === 'confirmation' ? 'confirmation' : 'outbox')
    );
    if (!alert) throw new Error('Ordinary transition erased the retained duty');
    expect(
      await runAttachmentOperator(
        [duty === 'confirmation' ? 'recover-confirmation' : 'recover-outbox', alert.id],
        { databaseUrl, maxAttempts: 2, retryDelayMs: 1 }
      )
    ).toEqual({ recovered: true });
    if (duty !== 'confirmation') {
      if (transition === 'source') {
        await runtime.dispose();
        runtime = ManagedRuntime.make(layer());
      }
      expect(await status(i)).toMatchObject({ attachment: { attentionRequired: true } });
      const recovered = await claimPublication(publicationId);
      expect(recovered.event).toEqual(original?.event);
      await runtime.runPromise(AttachmentDelivery.use((d) => d.complete(recovered)));
    }
    expect(await status(i)).toMatchObject({
      attachment: { ...completed, attentionRequired: false },
    });
    expect(await sql`select picture_asset_id,version from profiles`).toEqual([
      {
        picture_asset_id: transition === 'source' ? 'asset-A' : null,
        version: transition === 'source' ? 2 : 1,
      },
    ]);
    expect(await sql`select count(*)::int as count from outbox_events`).toEqual([
      { count: transition === 'source' ? 1 : 0 },
    ]);
    expect(await runtime.runPromise(AttachmentDelivery.use((d) => d.alerts()))).toEqual([]);
  });
  it('atomically reserves command identity, replays through restart and attaches only after the required registered Source', async () => {
    const [a, b] = await Promise.all([begin(), begin()]);
    expect(a.id).toBe(b.id);
    expect(await sql`select count(*)::int as count from picture_attachment_outbox`).toEqual([
      { count: 1 },
    ]);
    await created(a);
    expect(await sql`select picture_asset_id,version from profiles`).toEqual([
      { picture_asset_id: null, version: 1 },
    ]);
    await register(a);
    await runtime.dispose();
    runtime = ManagedRuntime.make(layer());
    expect(await confirm(a)).toBe('applied');
    expect(await confirm(a)).toBe('ignored');
    expect(await sql`select picture_asset_id,version from profiles`).toEqual([
      { picture_asset_id: 'asset-A', version: 2 },
    ]);
    const events = await sql`select payload from outbox_events`;
    expect(events).toHaveLength(1);
    expect(events[0].payload).toMatchObject({
      profile: { pictureAssetId: 'asset-A', version: 2 },
      change: { type: 'picture-changed', after: 'asset-A', asset: null },
    });
  });
  it('unlinks the Profile and commits the former Asset deletion locally without any delivery dependency', async () => {
    const i = await begin();
    await created(i);
    await register(i);
    expect(await confirm(i)).toBe('applied');
    expect(await remove(1)).toMatchObject({ _tag: 'Rejected', reason: 'version-conflict' });
    expect(await remove(2)).toMatchObject({
      _tag: 'Success',
      profile: { version: 3, pictureAssetId: null },
    });
    expect(
      await runtime.runPromise(PictureAttachments.use((s) => s.get({ profileId: 'owner' }, i.id)))
    ).toMatchObject({
      kind: 'attachment',
      attachment: { state: 'cancelled', assetId: 'asset-A', deletion: 'pending' },
    });
    const [deletion] =
      await sql`select event from picture_attachment_outbox where destination='asset-delete'`;
    expect(deletion.event).toMatchObject({
      id: i.deletionEventId,
      correlationid: i.id,
      data: { commandId: i.deleteCommandId, applicationReference: i.id, assetId: 'asset-A' },
    });
    expect(await remove(3)).toMatchObject({
      _tag: 'Success',
      profile: { version: 3, pictureAssetId: null },
    });
    expect(
      await sql`select event from picture_attachment_outbox where destination='asset-delete'`
    ).toEqual([deletion]);
  });
  it('gives a reused request key a fresh identity after unlink and fences every old completion from the later picture', async () => {
    const first = await begin();
    await created(first);
    await register(first);
    await confirm(first);
    await remove(2);
    const [next, retry] = await Promise.all([begin('first', 3), begin('first', 3)]);
    expect(next.id).not.toBe(first.id);
    expect(retry.id).toBe(next.id);
    expect((await begin('first', 1)).id).toBe(first.id);
    expect(next.commandId).not.toBe(first.commandId);
    await created(next, 'asset-B');
    await register(next);
    expect(await confirm({ ...next, assetId: 'asset-B' })).toBe('applied');
    expect(await created(first)).toBe('ignored');
    expect(await confirm(first)).toBe('ignored');
    await runtime.dispose();
    runtime = ManagedRuntime.make(layer());
    const deleted = () =>
      runtime.runPromise(
        PictureAttachments.use((s) =>
          s.assetResult({
            attachmentId: first.id,
            commandId: first.deleteCommandId,
            causationId: first.deletionEventId,
            assetId: 'asset-A',
            outcome: 'deleted',
          })
        )
      );
    expect(await deleted()).toBe('applied');
    expect(await deleted()).toBe('ignored');
    expect(await sql`select picture_asset_id,version from profiles`).toEqual([
      { picture_asset_id: 'asset-B', version: 4 },
    ]);
    const deletion =
      await sql`select event from picture_attachment_outbox where destination='asset-delete'`;
    expect(deletion).toHaveLength(1);
    expect(deletion[0].event).toMatchObject({
      id: first.deletionEventId,
      data: { commandId: first.deleteCommandId, assetId: 'asset-A' },
    });
  });
  it('commits only one unlink and former-Asset deletion when removals race at the same Profile version', async () => {
    const first = await begin();
    await created(first);
    await register(first);
    await confirm(first);

    const results = await Promise.all([remove(2), remove(2)]);
    expect(results.filter((result) => result._tag === 'Success')).toEqual([
      expect.objectContaining({
        profile: expect.objectContaining({ version: 3, pictureAssetId: null }),
      }),
    ]);
    expect(results.filter((result) => result._tag === 'Rejected')).toEqual([
      expect.objectContaining({ reason: 'version-conflict' }),
    ]);
    expect(await sql`select picture_asset_id,version from profiles`).toEqual([
      { picture_asset_id: null, version: 3 },
    ]);
    expect(
      await sql`select payload from outbox_events where payload->'change'->>'after' is null`
    ).toMatchObject([
      {
        payload: {
          profile: { version: 3 },
          change: { before: 'asset-A', after: null, source: 'remove' },
        },
      },
    ]);
    expect(
      await sql`select event from picture_attachment_outbox where destination='asset-delete'`
    ).toMatchObject([
      {
        event: {
          id: first.deletionEventId,
          data: { commandId: first.deleteCommandId, assetId: 'asset-A' },
        },
      },
    ]);
    expect(await status(first)).toMatchObject({
      attachment: { state: 'cancelled', deletion: 'pending' },
    });
  });
  it('leaves Source acceptance available after a stale picture removal is rejected', async () => {
    const first = await begin();
    await created(first);
    await register(first);

    expect(await remove(2)).toMatchObject({ _tag: 'Rejected', reason: 'version-conflict' });
    expect(await status(first)).toMatchObject({
      attachment: { state: 'accepting-source', deletion: 'none' },
    });
    expect(
      await sql`select id from picture_attachment_outbox where destination='asset-delete'`
    ).toEqual([]);
    expect(await sql`select id from outbox_events`).toEqual([]);
    expect(await confirm(first)).toBe('applied');
    expect(await sql`select picture_asset_id,version from profiles`).toEqual([
      { picture_asset_id: 'asset-A', version: 2 },
    ]);
  });
  it('keeps an attached picture and its deletion identity intact after an ordinary Profile edit', async () => {
    const first = await begin();
    await created(first);
    await register(first);
    await confirm(first);

    const owner = ManagedRuntime.make(
      profileStoreLayer(profilePolicy).pipe(Layer.provide(databaseLayer({ databaseUrl })))
    );
    try {
      expect(
        await owner.runPromise(
          ProfileStore.use((store) =>
            store.transact({ profileId: 'owner', now: new Date() }, () => ({
              _tag: 'Change',
              mutation: { type: 'details', displayName: 'Updated owner', biographyMarkdown: '' },
            }))
          )
        )
      ).toMatchObject({
        changed: true,
        outcome: { _tag: 'Success', profile: { pictureAssetId: 'asset-A', version: 3 } },
      });
    } finally {
      await owner.dispose();
    }
    expect(await status(first)).toMatchObject({
      attachment: { state: 'attached', deletion: 'none' },
    });
    expect(
      await sql`select id from picture_attachment_outbox where destination='asset-delete'`
    ).toEqual([]);
    expect(await remove(3)).toMatchObject({
      _tag: 'Success',
      profile: { version: 4, pictureAssetId: null },
    });
    expect(
      await sql`select event from picture_attachment_outbox where destination='asset-delete'`
    ).toMatchObject([
      {
        event: {
          id: first.deletionEventId,
          data: { commandId: first.deleteCommandId, assetId: 'asset-A' },
        },
      },
    ]);
  });
  it('uses the generated avatar without allocating or deleting an Asset when no attachment has been reserved', async () => {
    expect(await remove(1)).toMatchObject({
      _tag: 'Success',
      profile: { version: 1, pictureAssetId: null },
    });
    expect(await sql`select id from picture_attachment_intents`).toEqual([]);
    expect(await sql`select id from picture_attachment_outbox`).toEqual([]);
    expect(await sql`select id from outbox_events`).toEqual([]);
  });
  it.each([
    'creating',
    'awaiting-source',
    'accepting-source',
  ])('removes an empty Profile during %s and durably deletes a late-created Asset', async (state) => {
    const first = await begin();
    if (state !== 'creating') await created(first);
    if (state === 'accepting-source') await register(first);
    expect(await remove(1)).toMatchObject({
      _tag: 'Success',
      profile: { version: 2, pictureAssetId: null },
    });
    if (state === 'creating') expect(await created(first)).toBe('applied');
    expect(await confirm(first)).toBe('ignored');
    expect(
      await runtime.runPromise(
        PictureAttachments.use((s) => s.get({ profileId: 'owner' }, first.id))
      )
    ).toMatchObject({
      attachment: { state: 'conflicted', assetId: 'asset-A', deletion: 'pending' },
    });
    expect(
      await sql`select event from picture_attachment_outbox where destination='asset-delete'`
    ).toMatchObject([
      {
        event: {
          id: first.deletionEventId,
          data: { commandId: first.deleteCommandId, assetId: 'asset-A' },
        },
      },
    ]);
    expect(await remove(2)).toMatchObject({
      _tag: 'Success',
      profile: { version: 2, pictureAssetId: null },
    });
  });
  it.each([
    'outbox_events',
    'picture_attachment_outbox',
  ])('rolls back unlink, intent and delete duty when %s cannot commit', async (table) => {
    const first = await begin();
    await created(first);
    await register(first);
    await confirm(first);
    await sql.unsafe(
      "create function reject_unlink_write() returns trigger language plpgsql as $$ begin raise exception 'intentional unlink write failure'; end $$"
    );
    await sql.unsafe(
      `create trigger reject_unlink_write before insert on ${table} for each row execute function reject_unlink_write()`
    );
    try {
      await expect(remove(2)).rejects.toMatchObject({ _tag: 'ProfileUnavailable' });
      expect(await sql`select picture_asset_id,version from profiles`).toEqual([
        { picture_asset_id: 'asset-A', version: 2 },
      ]);
      expect(
        await runtime.runPromise(
          PictureAttachments.use((s) => s.get({ profileId: 'owner' }, first.id))
        )
      ).toMatchObject({
        attachment: { state: 'attached', deletion: 'none' },
      });
      expect(
        await sql`select id from picture_attachment_outbox where destination='asset-delete'`
      ).toEqual([]);
    } finally {
      await sql.unsafe(
        `drop trigger reject_unlink_write on ${table};drop function reject_unlink_write()`
      );
    }
    expect(await remove(2)).toMatchObject({
      _tag: 'Success',
      profile: { version: 3, pictureAssetId: null },
    });
    expect(
      await sql`select event from picture_attachment_outbox where destination='asset-delete'`
    ).toMatchObject([
      {
        event: {
          id: first.deletionEventId,
          data: { commandId: first.deleteCommandId, assetId: 'asset-A' },
        },
      },
    ]);
  });
  it('rolls back the intent and Profile together when its event cannot commit', async () => {
    const i = await begin();
    await created(i);
    await register(i);
    await exhaustPublication(i.creationEventId);
    await sql.unsafe(
      `create function reject_attachment_event() returns trigger language plpgsql as $$ begin raise exception 'intentional event failure'; end $$`
    );
    await sql.unsafe(
      'create trigger reject_attachment_event before insert on outbox_events for each row execute function reject_attachment_event()'
    );
    try {
      await expect(confirm(i)).rejects.toMatchObject({ _tag: 'AttachmentFailure' });
      expect(await sql`select picture_asset_id,version from profiles`).toEqual([
        { picture_asset_id: null, version: 1 },
      ]);
      expect(
        await runtime.runPromise(PictureAttachments.use((s) => s.get({ profileId: 'owner' }, i.id)))
      ).toMatchObject({
        kind: 'attachment',
        attachment: { state: 'accepting-source', attentionRequired: true },
      });
    } finally {
      await sql.unsafe(
        'drop trigger reject_attachment_event on outbox_events;drop function reject_attachment_event()'
      );
    }
    expect(await confirm(i)).toBe('applied');
    expect(await status(i)).toMatchObject({
      attachment: { state: 'attached', attentionRequired: true },
    });
  });
  it('clears publication attention while ordinary orphan deletion is pending, preserving rejected-deletion attention until a successful result', async () => {
    const i = await begin();
    await created(i);
    await runtime.runPromise(PictureAttachments.use((s) => s.cancel({ profileId: 'owner' }, i.id)));
    await exhaustPublication(i.creationEventId);
    expect(
      await runtime.runPromise(AttachmentDelivery.use((d) => d.recover(i.creationEventId)))
    ).toBe(true);
    expect(await status(i)).toMatchObject({
      attachment: { deletion: 'pending', attentionRequired: true },
    });
    const publication = await claimPublication(i.creationEventId);
    await runtime.runPromise(AttachmentDelivery.use((d) => d.complete(publication)));
    expect(await status(i)).toMatchObject({
      attachment: { deletion: 'pending', attentionRequired: false },
    });
    expect(
      await runtime.runPromise(
        PictureAttachments.use((s) =>
          s.assetResult({
            attachmentId: i.id,
            commandId: i.deleteCommandId,
            causationId: i.deletionEventId,
            assetId: 'asset-A',
            outcome: 'rejected',
          })
        )
      )
    ).toBe('requires-attention');
    await runtime.dispose();
    runtime = ManagedRuntime.make(layer());
    const retained = creationConfirmation(i);
    await runtime.runPromise(
      AttachmentDelivery.use((d) =>
        d.quarantine('old-create', retained, 'confirmation-exhausted', { kind: 'intent', id: i.id })
      )
    );
    const alert = (await runtime.runPromise(AttachmentDelivery.use((d) => d.alerts()))).find(
      (a) => a.scope === 'confirmation'
    );
    if (!alert) throw new Error('Missing retained confirmation');
    expect(
      await runAttachmentOperator(['recover-confirmation', alert.id], {
        databaseUrl,
        maxAttempts: 2,
        retryDelayMs: 1,
      })
    ).toEqual({ recovered: true });
    expect(await status(i)).toMatchObject({
      attachment: { deletion: 'pending', attentionRequired: true },
    });
    expect(
      await runtime.runPromise(
        PictureAttachments.use((s) =>
          s.assetResult({
            attachmentId: i.id,
            commandId: i.deleteCommandId,
            causationId: i.deletionEventId,
            assetId: 'asset-A',
            outcome: 'deleted',
          })
        )
      )
    ).toBe('applied');
    expect(await status(i)).toMatchObject({
      attachment: { deletion: 'complete', attentionRequired: false },
    });
  });
  it.each([
    'exhaustion',
    'recovery',
  ])('serializes ordinary Source attachment with concurrent publication %s', async (operation) => {
    const i = await begin();
    await created(i);
    await register(i);
    const first = await claimPublication(i.creationEventId);
    await runtime.runPromise(AttachmentDelivery.use((d) => d.failed(first)));
    await sql`update picture_attachment_outbox set available_at=now()-interval '1 second' where id=${first.id}`;
    const second = await claimPublication(i.creationEventId);
    if (operation === 'recovery') {
      await runtime.runPromise(AttachmentDelivery.use((d) => d.failed(second)));
      expect(await runtime.runPromise(AttachmentDelivery.use((d) => d.recover(second.id)))).toBe(
        true
      );
    }
    const current = operation === 'recovery' ? await claimPublication(second.id) : second;
    const [outcome] = await Promise.all([
      confirm(i),
      runtime.runPromise(
        AttachmentDelivery.use((d) =>
          operation === 'recovery' ? d.complete(current) : d.failed(current)
        )
      ),
    ]);
    expect(outcome).toBe('applied');
    expect(await status(i)).toMatchObject({
      attachment: { state: 'attached', attentionRequired: operation === 'exhaustion' },
    });
    expect(await sql`select picture_asset_id,version from profiles`).toEqual([
      { picture_asset_id: 'asset-A', version: 2 },
    ]);
    expect(await sql`select count(*)::int as count from outbox_events`).toEqual([{ count: 1 }]);
  });
  it.each([
    'source',
    'deletion',
  ])('recovers exhausted duplicate %s confirmation without leaving completed work in attention', async (kind) => {
    const i = await begin();
    await created(i);
    if (kind === 'source') {
      await register(i);
      expect(await confirm(i)).toBe('applied');
    } else {
      await runtime.runPromise(
        PictureAttachments.use((s) => s.cancel({ profileId: 'owner' }, i.id))
      );
      expect(
        await runtime.runPromise(
          PictureAttachments.use((s) =>
            s.assetResult({
              attachmentId: i.id,
              commandId: i.deleteCommandId,
              causationId: i.deletionEventId,
              outcome: 'deleted',
              assetId: 'asset-A',
            })
          )
        )
      ).toBe('applied');
    }
    const completed =
      kind === 'source' ? { state: 'attached' } : { state: 'cancelled', deletion: 'complete' };
    const source = sourceConfirmation();
    const result = {
      ...source,
      type: 'asset.command.result',
      causationsource: 'https://wallpaperdb/user',
      causationid: i.deletionEventId,
      data: {
        commandId: i.deleteCommandId,
        applicationReference: i.id,
        outcome: 'deleted',
        assetId: 'asset-A',
      },
    };
    const payload = JSON.stringify(kind === 'source' ? source : result);
    const quarantine = () =>
      runtime.runPromise(
        AttachmentDelivery.use((d) =>
          d.quarantine(
            'duplicate-source-A',
            payload,
            'confirmation-exhausted',
            kind === 'source' ? { kind: 'asset', id: 'asset-A' } : { kind: 'intent', id: i.id }
          )
        )
      );
    const status = () =>
      runtime.runPromise(PictureAttachments.use((s) => s.get({ profileId: 'owner' }, i.id)));
    await quarantine();
    expect(await status()).toMatchObject({
      kind: 'attachment',
      attachment: { ...completed, attentionRequired: true },
    });
    const alert = (await runtime.runPromise(AttachmentDelivery.use((d) => d.alerts()))).find(
      (a) => a.scope === 'confirmation'
    );
    if (!alert) throw new Error('Missing exhausted confirmation alert');
    expect(
      await Promise.all([
        runAttachmentOperator(['recover-confirmation', alert.id], {
          databaseUrl,
          maxAttempts: 2,
          retryDelayMs: 1,
        }),
        quarantine(),
      ]).then(([recovered]) => recovered)
    ).toEqual({ recovered: true });
    expect(await status()).toMatchObject({
      kind: 'attachment',
      attachment: { ...completed, attentionRequired: false },
    });
    await quarantine();
    expect(await status()).toMatchObject({
      kind: 'attachment',
      attachment: { ...completed, attentionRequired: false },
    });
    expect(await runtime.runPromise(AttachmentDelivery.use((d) => d.alerts()))).toEqual([]);
    expect(
      await runAttachmentOperator(['recover-confirmation', alert.id], {
        databaseUrl,
        maxAttempts: 2,
        retryDelayMs: 1,
      })
    ).toEqual({ recovered: false });
    expect(await sql`select picture_asset_id,version from profiles`).toEqual([
      {
        picture_asset_id: kind === 'source' ? 'asset-A' : null,
        version: kind === 'source' ? 2 : 1,
      },
    ]);
    expect(await sql`select count(*)::int as count from outbox_events`).toEqual([
      { count: kind === 'source' ? 1 : 0 },
    ]);
  });
  it.each([
    'confirmation',
    'outbox',
    'deletion',
  ])('preserves outstanding %s attention while recovering a completed creation result', async (remaining) => {
    const i = await begin();
    await created(i);
    if (remaining === 'deletion') {
      await runtime.runPromise(
        PictureAttachments.use((s) => s.cancel({ profileId: 'owner' }, i.id))
      );
      expect(
        await runtime.runPromise(
          PictureAttachments.use((s) =>
            s.assetResult({
              attachmentId: i.id,
              commandId: i.deleteCommandId,
              causationId: i.deletionEventId,
              outcome: 'rejected',
              assetId: 'asset-A',
            })
          )
        )
      ).toBe('requires-attention');
    } else {
      await register(i);
      await confirm(i);
    }
    const payload = JSON.stringify({
      ...sourceConfirmation(),
      type: 'asset.command.result',
      causationsource: 'https://wallpaperdb/user',
      causationid: i.creationEventId,
      data: {
        commandId: i.commandId,
        applicationReference: i.id,
        outcome: 'created',
        assetId: 'asset-A',
      },
    });
    await runtime.runPromise(
      AttachmentDelivery.use((d) =>
        d.quarantine('old-create', payload, 'confirmation-exhausted', { kind: 'intent', id: i.id })
      )
    );
    const alert = (await runtime.runPromise(AttachmentDelivery.use((d) => d.alerts()))).find(
      (a) => a.scope === 'confirmation'
    );
    if (!alert) throw new Error('Missing creation confirmation alert');
    if (remaining === 'confirmation') {
      await runtime.runPromise(
        AttachmentDelivery.use((d) =>
          d.quarantine(
            'source-confirmation',
            JSON.stringify(sourceConfirmation()),
            'confirmation-exhausted',
            { kind: 'asset', id: 'asset-A' }
          )
        )
      );
    } else if (remaining === 'outbox') {
      for (let n = 0; n < 2; n++) {
        const claim = (await runtime.runPromise(AttachmentDelivery.use((d) => d.claim())))[0];
        if (!claim) throw new Error('Missing real outbox claim');
        await runtime.runPromise(AttachmentDelivery.use((d) => d.failed(claim)));
        await sql`update picture_attachment_outbox set available_at=now()-interval '1 second' where id=${claim.id}`;
      }
    }
    expect(
      await runAttachmentOperator(['recover-confirmation', alert.id], {
        databaseUrl,
        maxAttempts: 2,
        retryDelayMs: 1,
      })
    ).toEqual({ recovered: true });
    const status = () =>
      runtime.runPromise(PictureAttachments.use((s) => s.get({ profileId: 'owner' }, i.id)));
    expect(await status()).toMatchObject({
      kind: 'attachment',
      attachment: { attentionRequired: true },
    });
    if (remaining === 'confirmation') {
      const publication = (await runtime.runPromise(AttachmentDelivery.use((d) => d.claim()))).find(
        (p) => p.id === i.creationEventId
      );
      if (!publication) throw new Error('Missing publication beside unresolved confirmation');
      await runtime.runPromise(AttachmentDelivery.use((d) => d.complete(publication)));
      expect(await status()).toMatchObject({
        kind: 'attachment',
        attachment: { attentionRequired: true },
      });
      const other = (await runtime.runPromise(AttachmentDelivery.use((d) => d.alerts()))).find(
        (a) => a.scope === 'confirmation' && a.id !== alert.id
      );
      if (!other) throw new Error('Missing other unresolved confirmation');
      expect(
        await runAttachmentOperator(['recover-confirmation', other.id], {
          databaseUrl,
          maxAttempts: 2,
          retryDelayMs: 1,
        })
      ).toEqual({ recovered: true });
      expect(await status()).toMatchObject({
        kind: 'attachment',
        attachment: { state: 'attached', attentionRequired: false },
      });
    } else if (remaining === 'outbox') {
      expect(await runtime.runPromise(AttachmentDelivery.use((d) => d.alerts()))).toContainEqual({
        id: i.creationEventId,
        scope: 'outbox',
        reason: 'exhausted',
        quarantineId: expect.any(String),
      });
      expect(
        await runAttachmentOperator(['recover-outbox', i.creationEventId], {
          databaseUrl,
          maxAttempts: 2,
          retryDelayMs: 1,
        })
      ).toEqual({ recovered: true });
      const publication = (await runtime.runPromise(AttachmentDelivery.use((d) => d.claim()))).find(
        (p) => p.id === i.creationEventId
      );
      if (!publication) throw new Error('Missing recovered publication');
      await runtime.runPromise(AttachmentDelivery.use((d) => d.complete(publication)));
      expect(await status()).toMatchObject({
        kind: 'attachment',
        attachment: { state: 'attached', attentionRequired: false },
      });
    } else {
      const publication = (await runtime.runPromise(AttachmentDelivery.use((d) => d.claim()))).find(
        (p) => p.id === i.creationEventId
      );
      if (!publication) throw new Error('Missing publication beside rejected deletion');
      await runtime.runPromise(AttachmentDelivery.use((d) => d.complete(publication)));
      expect(await status()).toMatchObject({
        kind: 'attachment',
        attachment: { deletion: 'pending', attentionRequired: true },
      });
      expect(
        await runtime.runPromise(
          PictureAttachments.use((s) =>
            s.assetResult({
              attachmentId: i.id,
              commandId: i.deleteCommandId,
              causationId: i.deletionEventId,
              outcome: 'deleted',
              assetId: 'asset-A',
            })
          )
        )
      ).toBe('applied');
      await runtime.runPromise(
        AttachmentDelivery.use((d) =>
          d.quarantine('old-create', payload, 'confirmation-exhausted', {
            kind: 'intent',
            id: i.id,
          })
        )
      );
      expect(await status()).toMatchObject({
        kind: 'attachment',
        attachment: { state: 'cancelled', deletion: 'complete', attentionRequired: false },
      });
    }
  });
  it.each([
    'creation',
    'deletion',
  ])('clears exhausted %s publication attention after trusted recovery, matching completion and duplicate result', async (kind) => {
    const i = await begin();
    await created(i);
    if (kind === 'creation') {
      await register(i);
      await confirm(i);
    } else {
      const creation = (await runtime.runPromise(AttachmentDelivery.use((d) => d.claim())))[0];
      if (!creation) throw new Error('Missing creation publication');
      await runtime.runPromise(AttachmentDelivery.use((d) => d.complete(creation)));
      await runtime.runPromise(
        PictureAttachments.use((s) => s.cancel({ profileId: 'owner' }, i.id))
      );
      await runtime.runPromise(
        PictureAttachments.use((s) =>
          s.assetResult({
            attachmentId: i.id,
            commandId: i.deleteCommandId,
            causationId: i.deletionEventId,
            outcome: 'deleted',
            assetId: 'asset-A',
          })
        )
      );
    }
    const claim = () => runtime.runPromise(AttachmentDelivery.use((d) => d.claim()));
    const first = (await claim())[0];
    if (!first) throw new Error('Missing original publication');
    await runtime.runPromise(AttachmentDelivery.use((d) => d.failed(first)));
    await sql`update picture_attachment_outbox set available_at=now()-interval '1 second' where id=${first.id}`;
    const second = (await claim())[0];
    if (!second) throw new Error('Missing ambiguous publication retry');
    await runtime.runPromise(AttachmentDelivery.use((d) => d.failed(second)));
    const status = () =>
      runtime.runPromise(PictureAttachments.use((s) => s.get({ profileId: 'owner' }, i.id)));
    expect(await status()).toMatchObject({
      kind: 'attachment',
      attachment: { attentionRequired: true },
    });
    expect(
      await runAttachmentOperator(['recover-outbox', first.id], {
        databaseUrl,
        maxAttempts: 2,
        retryDelayMs: 1,
      })
    ).toEqual({ recovered: true });
    const recovered = (await claim())[0];
    if (!recovered) throw new Error('Missing recovered publication');
    expect(recovered.event).toEqual(first.event);
    expect(recovered.attempts).toBe(0);
    await runtime.runPromise(AttachmentDelivery.use((d) => d.complete(first)));
    await runtime.runPromise(AttachmentDelivery.use((d) => d.failed(second)));
    expect(await status()).toMatchObject({
      kind: 'attachment',
      attachment: { attentionRequired: true },
    });
    await runtime.runPromise(AttachmentDelivery.use((d) => d.complete(recovered)));
    expect(
      kind === 'creation'
        ? await created(i)
        : await runtime.runPromise(
            PictureAttachments.use((s) =>
              s.assetResult({
                attachmentId: i.id,
                commandId: i.deleteCommandId,
                causationId: i.deletionEventId,
                outcome: 'deleted',
                assetId: 'asset-A',
              })
            )
          )
    ).toBe('ignored');
    expect(await status()).toMatchObject({
      kind: 'attachment',
      attachment: {
        state: kind === 'creation' ? 'attached' : 'cancelled',
        attentionRequired: false,
      },
    });
    expect(await runtime.runPromise(AttachmentDelivery.use((d) => d.alerts()))).toEqual([]);
    expect(
      await runAttachmentOperator(['recover-outbox', first.id], {
        databaseUrl,
        maxAttempts: 2,
        retryDelayMs: 1,
      })
    ).toEqual({ recovered: false });
    expect(await sql`select picture_asset_id,version from profiles`).toEqual([
      {
        picture_asset_id: kind === 'creation' ? 'asset-A' : null,
        version: kind === 'creation' ? 2 : 1,
      },
    ]);
  });
  it.each([
    'complete',
    'failed',
    'claim',
  ])('serializes %s with repeated cancellation without changing the orphan command', async (operation) => {
    const i = await begin();
    await created(i);
    const cancel = () =>
      runtime.runPromise(PictureAttachments.use((s) => s.cancel({ profileId: 'owner' }, i.id)));
    await cancel();
    const claim = () => runtime.runPromise(AttachmentDelivery.use((d) => d.claim()));
    const publications = await claim();
    const creation = publications.find((p) => p.id === i.creationEventId);
    let deletion = publications.find((p) => p.id === i.deletionEventId);
    if (!creation || !deletion) throw new Error('Missing claimed create/delete publications');
    const firstDeletion = deletion;
    await runtime.runPromise(AttachmentDelivery.use((d) => d.complete(creation)));
    if (operation !== 'complete') {
      if (operation === 'failed')
        await runtime.runPromise(AttachmentDelivery.use((d) => d.failed(firstDeletion)));
      await sql`update picture_attachment_outbox set available_at=now()-interval '1 second' where id=${deletion.id}`;
      deletion = (await claim()).find((p) => p.id === i.deletionEventId);
      if (!deletion) throw new Error('Missing second deletion claim');
      if (operation === 'claim')
        await sql`update picture_attachment_outbox set available_at=now()-interval '1 second' where id=${deletion.id}`;
    }
    const current = deletion;
    await Promise.all([
      cancel(),
      operation === 'claim'
        ? claim()
        : runtime.runPromise(
            AttachmentDelivery.use((d) =>
              operation === 'complete' ? d.complete(current) : d.failed(current)
            )
          ),
    ]);
    if (operation === 'claim') await claim();
    expect(
      await sql`select event->>'id' as id,status from picture_attachment_outbox where destination='asset-delete'`
    ).toEqual([
      { id: i.deletionEventId, status: operation === 'complete' ? 'published' : 'quarantined' },
    ]);
    expect(
      await runtime.runPromise(PictureAttachments.use((s) => s.get({ profileId: 'owner' }, i.id)))
    ).toMatchObject({
      kind: 'attachment',
      attachment: {
        state: 'cancelled',
        assetId: 'asset-A',
        deletion: 'pending',
        ...(operation === 'complete' ? {} : { attentionRequired: true }),
      },
    });
  });
  it('keeps independent quarantined publication attention when another completed command is acknowledged', async () => {
    const i = await begin();
    await created(i);
    await runtime.runPromise(PictureAttachments.use((s) => s.cancel({ profileId: 'owner' }, i.id)));
    await runtime.runPromise(
      PictureAttachments.use((s) =>
        s.assetResult({
          attachmentId: i.id,
          commandId: i.deleteCommandId,
          causationId: i.deletionEventId,
          outcome: 'deleted',
          assetId: 'asset-A',
        })
      )
    );
    const claim = () => runtime.runPromise(AttachmentDelivery.use((d) => d.claim()));
    const first = await claim();
    let creation = first.find((p) => p.id === i.creationEventId);
    const deletion = first.find((p) => p.id === i.deletionEventId);
    if (!creation || !deletion) throw new Error('Missing initial publications');
    await runtime.runPromise(AttachmentDelivery.use((d) => d.failed(deletion)));
    await sql`update picture_attachment_outbox set available_at=now()-interval '1 second' where id=${deletion.id}`;
    const second = await claim();
    creation = second.find((p) => p.id === i.creationEventId) ?? creation;
    const retried = second.find((p) => p.id === i.deletionEventId);
    if (!retried) throw new Error('Missing deletion retry');
    await runtime.runPromise(AttachmentDelivery.use((d) => d.failed(retried)));
    const current = creation;
    await runtime.runPromise(AttachmentDelivery.use((d) => d.complete(current)));
    expect(
      await sql`select status from picture_attachment_outbox where id=${i.creationEventId}`
    ).toEqual([{ status: 'published' }]);
    expect(
      await runtime.runPromise(PictureAttachments.use((s) => s.get({ profileId: 'owner' }, i.id)))
    ).toMatchObject({
      kind: 'attachment',
      attachment: { deletion: 'complete', attentionRequired: true },
    });
    expect(await runtime.runPromise(AttachmentDelivery.use((d) => d.alerts()))).toContainEqual({
      id: i.deletionEventId,
      scope: 'outbox',
      reason: 'exhausted',
      quarantineId: expect.any(String),
    });
  });
  it('serializes cancellation and late creation with one exact durable orphan-delete command', async () => {
    const i = await begin();
    await runtime.runPromise(PictureAttachments.use((s) => s.cancel({ profileId: 'owner' }, i.id)));
    await runtime.dispose();
    runtime = ManagedRuntime.make(layer());
    await created(i);
    await created(i);
    const commands =
      await sql`select event from picture_attachment_outbox where destination='asset-delete'`;
    expect(commands).toHaveLength(1);
    expect(commands[0].event).toMatchObject({
      id: i.deletionEventId,
      source: 'https://wallpaperdb/user',
      type: 'asset.command.delete',
      data: { commandId: i.deleteCommandId, applicationReference: i.id, assetId: 'asset-A' },
    });
    expect(await sql`select picture_asset_id from profiles`).toEqual([{ picture_asset_id: null }]);
  });
  it('commits conflict fencing and orphan deletion when a Profile edit wins without another attachment request', async () => {
    const i = await begin();
    await created(i);
    const profileRuntime = ManagedRuntime.make(
      profileStoreLayer(profilePolicy).pipe(Layer.provide(databaseLayer({ databaseUrl })))
    );
    try {
      expect(
        await profileRuntime.runPromise(
          ProfileStore.use((s) =>
            s.transact({ profileId: 'owner', now: new Date() }, () => ({
              _tag: 'Change',
              mutation: {
                type: 'details',
                displayName: 'New name',
                biographyMarkdown: 'Changed Biography',
              },
            }))
          )
        )
      ).toMatchObject({
        outcome: { _tag: 'Success', profile: { version: 2 } },
        changed: true,
      });
    } finally {
      await profileRuntime.dispose();
    }
    const intents = await sql`select state from picture_attachment_intents where id=${i.id}`;
    expect(intents[0].state).toMatchObject({
      state: 'conflicted',
      deletion: 'pending',
      assetId: 'asset-A',
    });
    expect(
      await sql`select count(*)::int as count from picture_attachment_outbox where destination='asset-delete'`
    ).toEqual([{ count: 1 }]);
    expect(await remove(2)).toMatchObject({
      _tag: 'Success',
      profile: { version: 2, pictureAssetId: null },
    });
  });
  it('counts abandoned publication leases toward the same finite retry budget', async () => {
    const i = await begin();
    const claim = () => runtime.runPromise(AttachmentDelivery.use((d) => d.claim()));
    expect((await claim())[0]?.id).toBe(i.creationEventId);
    await sql`update picture_attachment_outbox set available_at=now()-interval '1 second'`;
    expect((await claim())[0]?.attempts).toBe(1);
    await sql`update picture_attachment_outbox set available_at=now()-interval '1 second'`;
    expect(await claim()).toEqual([]);
    expect(await runtime.runPromise(AttachmentDelivery.use((d) => d.alerts()))).toContainEqual({
      id: i.creationEventId,
      scope: 'outbox',
      reason: 'exhausted',
      quarantineId: expect.any(String),
    });
    expect(
      await runtime.runPromise(PictureAttachments.use((s) => s.get({ profileId: 'owner' }, i.id)))
    ).toMatchObject({ kind: 'attachment', attachment: { attentionRequired: true } });
  });
  it('leases finite publication attempts and makes quarantine available for deliberate recovery', async () => {
    const i = await begin();
    const claim = () => runtime.runPromise(AttachmentDelivery.use((d) => d.claim()));
    const first = (await claim())[0];
    if (!first) throw new Error('missing claim');
    await runtime.runPromise(AttachmentDelivery.use((d) => d.failed(first)));
    await sql`update picture_attachment_outbox set available_at=now()-interval '1 second' where id=${first.id}`;
    const second = (await claim())[0];
    if (!second) throw new Error('missing retry');
    expect(second.id).toBe(i.creationEventId);
    await runtime.runPromise(AttachmentDelivery.use((d) => d.failed(second)));
    expect(await claim()).toEqual([]);
    expect(await runtime.runPromise(AttachmentDelivery.use((d) => d.alerts()))).toContainEqual({
      id: i.creationEventId,
      scope: 'outbox',
      reason: 'exhausted',
      quarantineId: expect.any(String),
    });
    expect(
      await runAttachmentOperator(['recover-outbox', i.creationEventId], {
        databaseUrl,
        maxAttempts: 2,
        retryDelayMs: 1,
      })
    ).toEqual({ recovered: true });
    const recovered = (await claim())[0];
    expect(recovered?.event).toEqual(first.event);
    expect(recovered?.attempts).toBe(0);
  });
});
