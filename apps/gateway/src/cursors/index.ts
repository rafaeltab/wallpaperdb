import crypto from 'node:crypto';
import { DateTime, Effect, Layer, Schema } from 'effect';
import { CatalogueCursors, type CursorValue, type InvalidCursor } from '../catalogue/index.js';

const envelopeSchema = Schema.fromJsonString(
  Schema.Struct({
    payload: Schema.String,
    signature: Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/)),
  })
);
const payloadSchema = Schema.fromJsonString(
  Schema.Struct({
    values: Schema.Array(Schema.Union([Schema.String, Schema.Finite])),
    timestamp: Schema.Finite,
  })
);
const decodeEnvelope = Schema.decodeUnknownEffect(envelopeSchema);
const decodePayload = Schema.decodeUnknownEffect(payloadSchema);
export interface SignedCursorConfig {
  secret: string;
  expirationMs: number;
}
export function signedCursorsLayer(config: SignedCursorConfig): Layer.Layer<CatalogueCursors> {
  return Layer.effect(
    CatalogueCursors,
    Effect.sync(() => {
      const sign = (payload: string): string =>
        crypto.createHmac('sha256', config.secret).update(payload).digest('hex');
      const encode = Effect.fn('catalogue.cursors.encode')(function* (values: CursorValue[]) {
        const timestamp = DateTime.toEpochMillis(yield* DateTime.now);
        const payload = JSON.stringify({ values, timestamp });
        return Buffer.from(JSON.stringify({ payload, signature: sign(payload) })).toString(
          'base64url'
        );
      });
      const decode = Effect.fn('catalogue.cursors.decode')(
        function* (
          cursor: string
        ): Effect.fn.Return<
          { readonly _tag: 'Decoded'; readonly values: CursorValue[] } | InvalidCursor,
          Schema.SchemaError
        > {
          const envelope = yield* decodeEnvelope(Buffer.from(cursor, 'base64url').toString('utf8'));
          const expected = Buffer.from(sign(envelope.payload), 'hex');
          const supplied = Buffer.from(envelope.signature, 'hex');
          if (!crypto.timingSafeEqual(expected, supplied)) return { _tag: 'InvalidCursor' };
          const payload = yield* decodePayload(envelope.payload);
          const now = DateTime.toEpochMillis(yield* DateTime.now);
          if (payload.timestamp > now || now - payload.timestamp > config.expirationMs)
            return { _tag: 'InvalidCursor' };
          return { _tag: 'Decoded', values: [...payload.values] };
        },
        Effect.catchTag('SchemaError', () =>
          Effect.succeed<InvalidCursor>({ _tag: 'InvalidCursor' })
        )
      );
      return CatalogueCursors.of({ encode, decode });
    })
  );
}
