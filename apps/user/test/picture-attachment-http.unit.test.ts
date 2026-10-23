import { Effect, Layer } from 'effect';
import { describe, expect, it } from 'vitest';
import {
  AttachmentFailure,
  AttachmentHealth,
  PictureAttachments,
  type PictureAttachment,
} from '../src/capabilities/picture-attachments/index.js';
import { registerAttachmentHttp } from '../src/http/index.js';
import { createHttpApp } from '../src/http/index.js';
import { auth, services } from './http-fixture.js';
const unexpected = () => Effect.die('Unexpected attachment operation');
const intent: PictureAttachment = {
  id: 'attachment-A',
  profileId: 'user_owner',
  key: 'request-A',
  expectedVersion: 4,
  commandId: 'create-private',
  creationEventId: 'occurrence-private',
  deleteCommandId: 'delete-private',
  deletionEventId: 'delete-occurrence-private',
  createdAt: '2026-10-23T00:00:00Z',
  state: 'awaiting-source',
  assetId: 'asset-A',
  sourceIntent: null,
  sourceId: null,
  deletion: 'none',
};
const start = (overrides: Partial<PictureAttachments>) =>
  createHttpApp({ nodeEnv: 'test', port: 3009 }, services(unexpected), {
    configure: (app) =>
      registerAttachmentHttp(
        app,
        Layer.merge(
          Layer.succeed(AttachmentHealth, { check: () => Effect.succeed(true) }),
          Layer.succeed(PictureAttachments, {
            begin: unexpected,
            get: unexpected,
            expectSource: unexpected,
            cancel: unexpected,
            assetResult: unexpected,
            sourceAccepted: unexpected,
            ...overrides,
          })
        )
      ),
  });
describe('Initial picture attachment HTTP translation', () => {
  it('binds creation to the authenticated User and reports durable progress separately from attachment', async () => {
    const calls: unknown[] = [];
    const app = await start({
      begin: (principal, key, version) => {
        calls.push({ principal, key, version });
        return Effect.succeed({ kind: 'attachment', attachment: intent });
      },
      get: () =>
        Effect.succeed({
          kind: 'attachment',
          attachment: { ...intent, state: 'attached', sourceId: 'source-A' },
        }),
    });
    try {
      const input = {
        method: 'POST' as const,
        url: '/profile/me/picture-attachments',
        headers: { ...auth, 'idempotency-key': 'request-A' },
        payload: { expectedVersion: 4 },
      };
      expect(
        (await app.inject({ ...input, headers: { 'idempotency-key': 'request-A' } })).statusCode
      ).toBe(401);
      expect(
        (await app.inject({ ...input, payload: { expectedVersion: 4, profileId: 'foreign' } }))
          .statusCode
      ).toBe(400);
      expect((await app.inject({ ...input, payload: { expectedVersion: 0 } })).statusCode).toBe(
        400
      );
      const response = await app.inject(input);
      expect(response.statusCode).toBe(202);
      expect(response.json()).toEqual({
        attachmentId: 'attachment-A',
        state: 'awaiting-source',
        assetId: 'asset-A',
        sourceId: null,
        createdAt: intent.createdAt,
        deletion: 'none',
      });
      expect(response.headers['cache-control']).toBe('no-store');
      expect(calls).toEqual([
        { principal: { profileId: 'user_owner' }, key: 'request-A', version: 4 },
      ]);
      const completed = await app.inject({
        url: '/profile/me/picture-attachments/attachment-A',
        headers: auth,
      });
      expect(completed.statusCode).toBe(200);
      expect(completed.json()).toMatchObject({ state: 'attached', sourceId: 'source-A' });
    } finally {
      await app.close();
    }
  });
  it('registers exact Source intent, translates cancellation conflict and hides dependency diagnostics', async () => {
    const calls: unknown[] = [];
    const app = await start({
      expectSource: (principal, id, source) => {
        calls.push({ principal, id, source });
        return Effect.succeed({
          kind: 'attachment',
          attachment: { ...intent, state: 'accepting-source' },
        });
      },
      cancel: () => Effect.succeed({ kind: 'conflict' }),
      get: () =>
        Effect.fail(
          new AttachmentFailure({
            operation: 'read-private',
            cause: new Error('secret database password'),
          })
        ),
    });
    try {
      const response = await app.inject({
        method: 'PUT',
        url: '/profile/me/picture-attachments/attachment-A/first-source',
        headers: auth,
        payload: { candidateId: 'candidate-A', intentId: 'edit-A' },
      });
      expect(response.statusCode).toBe(202);
      expect(calls).toEqual([
        {
          principal: { profileId: 'user_owner' },
          id: 'attachment-A',
          source: { candidateId: 'candidate-A', intentId: 'edit-A' },
        },
      ]);
      expect(
        (
          await app.inject({
            method: 'DELETE',
            url: '/profile/me/picture-attachments/attachment-A',
            headers: auth,
          })
        ).statusCode
      ).toBe(409);
      const failed = await app.inject({
        url: '/profile/me/picture-attachments/attachment-A',
        headers: auth,
      });
      expect(failed.statusCode).toBe(503);
      expect(failed.json()).toMatchObject({
        status: 503,
        type: 'https://github.com/rafaeltab/wallpaperdb/blob/main/docs/problems/picture-workflow-unavailable.md',
      });
      expect(failed.body).not.toContain('secret');
    } finally {
      await app.close();
    }
  });
});
