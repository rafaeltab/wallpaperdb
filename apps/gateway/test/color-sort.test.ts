import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import { Schema } from 'effect';
import type { CatalogueConfig, ColorPreference } from '../src/catalogue/index.js';
import fixture from './fixtures/color-vectors.json';
import { setup } from './helpers/catalogue.js';

const fixtures = Schema.decodeUnknownSync(
  Schema.Array(
    Schema.Struct({
      strategy: Schema.Literals(['linear', 'exponential', 'exact']),
      color: Schema.String,
      vector: Schema.Array(Schema.Number),
    })
  )
)(fixture);
async function vector(
  colors: ColorPreference[],
  strategy: CatalogueConfig['colorSpreadStrategy'] = 'linear'
) {
  const { read, catalogue } = await setup({ colorSpreadStrategy: strategy });
  const outcome = await Effect.runPromise(catalogue.search({ colors }));
  expect(outcome._tag).toBe('Found');
  const result = read.selections[0]?.colorVector;
  if (!result) throw new Error('Expected a color-ranked search');
  return result;
}
describe('Catalogue color ranking policy', () => {
  it('accepts at most 64 color preferences before performing a catalogue read', async () => {
    const { read, catalogue } = await setup();
    const colors = Array.from({ length: 65 }, () => ({ color: '#FF0000', amount: 1 }));
    expect(await Effect.runPromise(catalogue.search({ colors }))).toMatchObject({
      _tag: 'InvalidSearch',
    });
    expect(read.selections).toEqual([]);

    expect(
      await Effect.runPromise(catalogue.search({ colors: colors.slice(0, 64) }))
    ).toMatchObject({ _tag: 'Found' });
    expect(read.selections).toHaveLength(1);
  });
  it.each(fixtures)('preserves the existing $strategy histogram for $color', async ({
    strategy,
    color,
    vector: expected,
  }) => {
    const actual = await vector([{ color, amount: 1 }], strategy);
    expect(actual).toHaveLength(64);
    actual.forEach((weight, index) => {
      expect(weight).toBeCloseTo(expected[index], 12);
    });
  });
  it.each([
    'linear',
    'exponential',
    'exact',
  ] as const)('adds weighted contributions with %s spread', async (strategy) => {
    const single = await vector([{ color: '#FF0000', amount: 1 }], strategy);
    const combined = await vector(
      [
        { color: '#FF0000', amount: 0.3 },
        { color: '#FF0000', amount: 0.7 },
      ],
      strategy
    );
    expect(combined).toEqual(single.map((value) => expect.closeTo(value, 12)));
    const doubled = await vector([{ color: '#FF0000', amount: 2 }], strategy);
    expect(doubled).toEqual(single.map((value) => expect.closeTo(value * 2, 12)));
  });
  it('supports lowercase hexadecimal colors', async () => {
    expect(await vector([{ color: '#aBcDeF', amount: 1 }])).toEqual(
      await vector([{ color: '#ABCDEF', amount: 1 }])
    );
  });
  it('defaults spread to one half and broadens the distribution as spread increases', async () => {
    const defaults = await vector([{ color: '#FF0000', amount: 1 }]);
    expect(defaults).toEqual(await vector([{ color: '#FF0000', amount: 1, spread: 0.5 }]));
    const narrow = await vector([{ color: '#FF0000', amount: 1, spread: 0 }]);
    const wide = await vector([{ color: '#FF0000', amount: 1, spread: 1 }]);
    expect(wide.reduce((a, b) => a + b, 0)).toBeGreaterThan(narrow.reduce((a, b) => a + b, 0));
  });
  it('places exact black and white in achromatic bins and adds different colors', async () => {
    const result = await vector(
      [
        { color: '#000000', amount: 2 },
        { color: '#FFFFFF', amount: 3 },
      ],
      'exact'
    );
    expect(result.slice(0, 48)).toEqual(Array(48).fill(0));
    expect(result[48]).toBe(2);
    expect(result[63]).toBe(3);
  });
  it.each(
    [
      [],
      [{ color: 'invalid', amount: 1 }],
      [{ color: 'FF0000', amount: 1 }],
      [{ color: '#F00', amount: 1 }],
      [{ color: '#GG0000', amount: 1 }],
      [{ color: '#FF0000', amount: 0 }],
      [{ color: '#FF0000', amount: -1 }],
      [{ color: '#FF0000', amount: Number.NaN }],
      [{ color: '#FF0000', amount: Number.POSITIVE_INFINITY }],
      [{ color: '#FF0000', amount: 1, spread: -0.1 }],
      [{ color: '#FF0000', amount: 1, spread: 1.1 }],
      [{ color: '#FF0000', amount: 1, spread: Number.NaN }],
    ].map((colors) => ({ colors }))
  )('rejects invalid color preferences before the read adapter runs: %j', async ({ colors }) => {
    const { read, catalogue } = await setup();
    expect(await Effect.runPromise(catalogue.search({ colors }))).toMatchObject({
      _tag: 'InvalidSearch',
    });
    expect(read.selections).toEqual([]);
  });
  it('reverses score ordering for backward pagination while retaining all sort values', async () => {
    const { read, cursors, catalogue } = await setup();
    const before = await Effect.runPromise(cursors.encode([0.7, 'wlpr_b']));
    await Effect.runPromise(
      catalogue.search({ colors: [{ color: '#FF0000', amount: 1 }], last: 2, before })
    );
    expect(read.selections[0]).toMatchObject({ sortOrder: 'asc', searchAfter: [0.7, 'wlpr_b'] });
  });
});
