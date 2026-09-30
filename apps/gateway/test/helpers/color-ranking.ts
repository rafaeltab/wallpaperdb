import { Schema } from 'effect';
import reference from '../fixtures/prototype/ranking.json';

/** Numerical inputs and outputs produced by the frozen executor, never by production code. */
export const rankingCases = Schema.decodeUnknownSync(
  Schema.Struct({
    cases: Schema.Array(
      Schema.Struct({
        name: Schema.String,
        quality: Schema.Literals(['relaxed', 'favorite', 'strict']),
        query: Schema.Struct({
          mode: Schema.Literals(['vibe', 'proportions']),
          targets: Schema.Array(
            Schema.Struct({
              color: Schema.optionalKey(Schema.String),
              name: Schema.optionalKey(Schema.String),
              percent: Schema.optionalKey(Schema.Int),
            })
          ),
        }),
        body: Schema.Record(Schema.String, Schema.Unknown),
        ranking: Schema.Struct({
          targetCount: Schema.Int,
          utilities: Schema.Array(Schema.Struct({ key: Schema.String, multiplicity: Schema.Int })),
        }),
      })
    ),
  })
)(reference).cases;
