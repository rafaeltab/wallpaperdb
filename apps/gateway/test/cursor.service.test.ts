import crypto from 'node:crypto';
import { expect, layer } from '@effect/vitest';
import { Effect } from 'effect';
import { TestClock } from 'effect/testing';
import { CatalogueCursors } from '../src/catalogue/index.js';
import { signedCursorsLayer } from '../src/cursors/index.js';
const config = { secret: 'test-secret-that-is-definitely-long-enough', expirationMs: 60_000 };
function signed(payload: unknown) {
  const text = JSON.stringify(payload);
  const signature = crypto.createHmac('sha256', config.secret).update(text).digest('hex');
  return Buffer.from(JSON.stringify({ payload: text, signature })).toString('base64url');
}
layer(signedCursorsLayer(config))('Signed pagination cursor adapter', (it) => {
  it.effect('preserves mixed score/identity positions and retains the pre-migration envelope', () =>
    Effect.gen(function* () {
      const cursors = yield* CatalogueCursors;
      yield* TestClock.setTime(1_000);
      const cursor = yield* cursors.encode([42, 'wlpr_a']);
      expect(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))).toEqual({
        payload: JSON.stringify({ values: [42, 'wlpr_a'], timestamp: 1000 }),
        signature: expect.stringMatching(/^[0-9a-f]{64}$/),
      });
      expect(yield* cursors.decode(cursor)).toEqual({ _tag: 'Decoded', values: [42, 'wlpr_a'] });
    })
  );
  it.effect('accepts the expiration boundary and rejects the next millisecond', () =>
    Effect.gen(function* () {
      const cursors = yield* CatalogueCursors;
      yield* TestClock.setTime(0);
      const cursor = yield* cursors.encode(['wlpr_a']);
      yield* TestClock.setTime(config.expirationMs);
      expect(yield* cursors.decode(cursor)).toEqual({ _tag: 'Decoded', values: ['wlpr_a'] });
      yield* TestClock.setTime(config.expirationMs + 1);
      expect(yield* cursors.decode(cursor)).toEqual({ _tag: 'InvalidCursor' });
    })
  );
  it.effect.each([
    '',
    'not-base64',
    Buffer.from('null').toString('base64url'),
    Buffer.from('{}').toString('base64url'),
    Buffer.from(JSON.stringify({ payload: '{}', signature: '0'.repeat(64) })).toString('base64url'),
    Buffer.from(JSON.stringify({ payload: '{}', signature: 'a' })).toString('base64url'),
    signed({ values: ['wlpr_a'], timestamp: 'wrong' }),
    signed({ values: ['wlpr_a'] }),
    signed({ values: [true], timestamp: 0 }),
    signed({ values: { id: 'wlpr_a' }, timestamp: 0 }),
    signed({ values: [null], timestamp: 0 }),
    signed({ values: ['wlpr_a'], timestamp: 1001 }),
  ])(
    'rejects malformed, tampered, and future cursors without exposing a parser error: %s',
    (cursor) =>
      Effect.gen(function* () {
        const cursors = yield* CatalogueCursors;
        yield* TestClock.setTime(1000);
        expect(yield* cursors.decode(cursor)).toEqual({ _tag: 'InvalidCursor' });
      })
  );
  it.effect('rejects a valid cursor signed by a different key', () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(0);
      const encoded = yield* CatalogueCursors.use((cursors) => cursors.encode(['wlpr_a'])).pipe(
        Effect.provide(signedCursorsLayer({ ...config, secret: 'another-signing-key' }))
      );
      expect(yield* CatalogueCursors.use((cursors) => cursors.decode(encoded))).toEqual({
        _tag: 'InvalidCursor',
      });
    })
  );
});
