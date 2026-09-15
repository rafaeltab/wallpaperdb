import crypto from 'node:crypto';
import { Clock, Effect, Schema } from 'effect';
import type { CatalogueCursors, CursorValue, InvalidCursor } from '../catalogue/index.js';

const envelopeSchema = Schema.Struct({ payload: Schema.String, signature: Schema.String });
const payloadSchema = Schema.Struct({
  values: Schema.Array(Schema.Union(Schema.String, Schema.Finite)),
  timestamp: Schema.Finite,
});
export interface SignedCursorConfig {
  secret: string;
  expirationMs: number;
}
class SignedCursors implements CatalogueCursors {
  constructor(private readonly config: SignedCursorConfig) {}
  encode(values: CursorValue[]): Effect.Effect<string> {
    return Effect.gen(this, function* () {
      const timestamp = yield* Clock.currentTimeMillis;
      const payload = JSON.stringify({ values, timestamp });
      return Buffer.from(JSON.stringify({ payload, signature: this.sign(payload) })).toString(
        'base64url'
      );
    }).pipe(Effect.withSpan('catalogue.cursors.encode'));
  }
  decode(
    cursor: string
  ): Effect.Effect<{ readonly _tag: 'Decoded'; readonly values: CursorValue[] } | InvalidCursor> {
    return Effect.gen(this, function* () {
      const envelope = yield* Schema.decodeUnknown(Schema.parseJson(envelopeSchema))(
        Buffer.from(cursor, 'base64url').toString('utf8')
      );
      const expected = Buffer.from(this.sign(envelope.payload), 'hex');
      const supplied = Buffer.from(envelope.signature, 'hex');
      if (!/^[0-9a-f]{64}$/.test(envelope.signature) || !crypto.timingSafeEqual(expected, supplied))
        return { _tag: 'InvalidCursor' as const };
      const payload = yield* Schema.decodeUnknown(Schema.parseJson(payloadSchema))(
        envelope.payload
      );
      const now = yield* Clock.currentTimeMillis;
      if (payload.timestamp > now || now - payload.timestamp > this.config.expirationMs)
        return { _tag: 'InvalidCursor' as const };
      return { _tag: 'Decoded' as const, values: [...payload.values] };
    }).pipe(
      Effect.catchAll(() => Effect.succeed({ _tag: 'InvalidCursor' as const })),
      Effect.withSpan('catalogue.cursors.decode')
    );
  }
  private sign(payload: string): string {
    return crypto.createHmac('sha256', this.config.secret).update(payload).digest('hex');
  }
}
export function createSignedCursors(config: SignedCursorConfig): CatalogueCursors {
  return new SignedCursors(config);
}
