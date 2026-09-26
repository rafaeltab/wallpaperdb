import { Effect, Layer } from 'effect';
import { describe, expect, it } from 'vitest';
import { createHttpApp } from '../src/http/index.js';
import { Pictures, PictureUnavailable } from '../src/pictures/index.js';
import type { Profiles } from '../src/profile/index.js';
import { auth, profile, services } from './http-fixture.js';

const unexpected = () => Effect.die('Unexpected picture command');
const pictureServices = (
  upload: Pictures['upload'] = unexpected,
  adoptPicture: Profiles['adoptPicture'] = unexpected
) =>
  Layer.merge(
    services(unexpected, unexpected, { adoptPicture }),
    Layer.succeed(Pictures, {
      stage: unexpected,
      upload,
      pictureAvailable: unexpected,
      importPending: unexpected,
      cleanupExpired: unexpected,
    })
  );
const config = { nodeEnv: 'test' as const, port: 3009, profilePictureMaxBytes: 8 };
function multipart(bytes: Buffer, version = '4') {
  return {
    headers: { ...auth, 'content-type': 'multipart/form-data; boundary=picture-test' },
    payload: Buffer.concat([
      Buffer.from(
        `--picture-test\r\nContent-Disposition: form-data; name="expectedVersion"\r\n\r\n${version}\r\n--picture-test\r\nContent-Disposition: form-data; name="picture"; filename="avatar.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`
      ),
      bytes,
      Buffer.from('\r\n--picture-test--\r\n'),
    ]),
  };
}

describe('Picture HTTP translation', () => {
  it('requires owner authentication before either picture command', async () => {
    const app = await createHttpApp(config, pictureServices());
    try {
      for (const method of ['PUT', 'DELETE'] as const) {
        const reply = await app.inject({
          method,
          url: '/profile/me/picture',
          payload: { expectedVersion: 4 },
        });
        expect(reply.statusCode).toBe(401);
      }
    } finally {
      await app.close();
    }
  });
  it('passes the authenticated owner, exact image bytes and parsed version to upload, and strips caller ownership from removal', async () => {
    const uploads: unknown[] = [];
    const removals: unknown[] = [];
    const app = await createHttpApp(
      config,
      pictureServices(
        (principal, bytes, version) => {
          uploads.push({ principal, bytes, version });
          return Effect.succeed({ _tag: 'Success', profile });
        },
        (principal, assetId, version) => {
          removals.push({ principal, assetId, version });
          return Effect.succeed({ _tag: 'Success', profile });
        }
      )
    );
    try {
      expect(
        (
          await app.inject({
            method: 'PUT',
            url: '/profile/me/picture',
            ...multipart(Buffer.from([0, 1, 255])),
          })
        ).statusCode
      ).toBe(200);
      expect(uploads).toEqual([
        { principal: { profileId: 'user_owner' }, bytes: Buffer.from([0, 1, 255]), version: 4 },
      ]);
      expect(
        (
          await app.inject({
            method: 'DELETE',
            url: '/profile/me/picture',
            headers: auth,
            payload: { expectedVersion: 7, profileId: 'other_owner' },
          })
        ).statusCode
      ).toBe(200);
      expect(removals).toEqual([
        { principal: { profileId: 'user_owner' }, assetId: null, version: 7 },
      ]);
    } finally {
      await app.close();
    }
  });
  it('bounds multipart bytes and rejects a malformed version before running the capability', async () => {
    const app = await createHttpApp(config, pictureServices());
    try {
      const oversized = await app.inject({
        method: 'PUT',
        url: '/profile/me/picture',
        ...multipart(Buffer.alloc(9)),
      });
      expect(oversized.statusCode).toBe(413);
      expect(oversized.json().type).toContain('picture-too-large');
      const invalid = await app.inject({
        method: 'PUT',
        url: '/profile/me/picture',
        ...multipart(Buffer.from('image'), '4x'),
      });
      expect(invalid.statusCode).toBe(400);
      expect(invalid.json().type).toContain('invalid-picture-command');
    } finally {
      await app.close();
    }
  });
  it.each([
    ['invalid-picture', 400, 'invalid-picture'],
    ['picture-too-large', 413, 'picture-too-large'],
    ['version-conflict', 409, 'profile-version-conflict'],
  ] as const)('maps %s rejection to its public status and problem type', async (reason, status, type) => {
    const app = await createHttpApp(
      config,
      pictureServices(() =>
        Effect.succeed({ _tag: 'Rejected', reason, message: 'Rejected command' })
      )
    );
    try {
      const reply = await app.inject({
        method: 'PUT',
        url: '/profile/me/picture',
        ...multipart(Buffer.from('image')),
      });
      expect(reply.statusCode).toBe(status);
      expect(reply.json().type).toContain(type);
    } finally {
      await app.close();
    }
  });
  it.each([
    ['put-picture', 503],
    ['create-candidate', 500],
  ] as const)('maps %s technical failure without exposing diagnostics', async (operation, status) => {
    const app = await createHttpApp(
      config,
      pictureServices(() =>
        Effect.fail(
          new PictureUnavailable({ operation, cause: new Error('PRIVATE_STORAGE_SECRET') })
        )
      )
    );
    try {
      const reply = await app.inject({
        method: 'PUT',
        url: '/profile/me/picture',
        ...multipart(Buffer.from('image')),
      });
      expect(reply.statusCode).toBe(status);
      expect(reply.body).not.toContain('PRIVATE_STORAGE_SECRET');
    } finally {
      await app.close();
    }
  });
  it('maps stale removal to a conflict', async () => {
    const app = await createHttpApp(
      config,
      pictureServices(unexpected, () =>
        Effect.succeed({
          _tag: 'Rejected',
          reason: 'version-conflict',
          message: 'Reload the Profile',
        })
      )
    );
    try {
      const reply = await app.inject({
        method: 'DELETE',
        url: '/profile/me/picture',
        headers: auth,
        payload: { expectedVersion: 4 },
      });
      expect(reply.statusCode).toBe(409);
      expect(reply.json().type).toContain('profile-version-conflict');
    } finally {
      await app.close();
    }
  });
});
