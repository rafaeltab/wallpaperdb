import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import { setup } from './helpers/catalogue.js';
import { COLOR_FEATURE_NAMES, type ColorQuery } from '../src/capabilities/catalogue/index.js';
import { rankingCases } from './helpers/color-ranking.js';

describe('Catalogue color query admission', () => {
  it('resolves every supported frozen input to its original-count utility ranking', async () => {
    const { read, catalogue } = await setup();
    for (const entry of rankingCases) {
      const result = await Effect.runPromise(
        catalogue.search({
          color: { ...entry.query, quality: entry.quality, targets: [...entry.query.targets] },
        })
      );
      expect(result, entry.name).toMatchObject({ _tag: 'Found' });
      expect(read.selections.at(-1)?.color, `${entry.name}/${entry.quality}`).toEqual(
        entry.ranking
      );
    }
  });
  it('defaults to the favorite vibe and resolves the nearest stored anchor', async () => {
    const { read, catalogue } = await setup();
    expect(
      await Effect.runPromise(catalogue.search({ color: { targets: [{ color: '#ff0000' }] } }))
    ).toMatchObject({ _tag: 'Found' });
    expect(read.selections[0]).toMatchObject({
      color: { utilities: [{ key: 'r0004_v_q050_w1', multiplicity: 1 }], targetCount: 1 },
      sortOrder: 'desc',
    });
  });
  it.each([
    'relaxed',
    'favorite',
    'strict',
  ] as const)('preserves independent proportions with %s quality', async (quality) => {
    for (const targets of [
      [{ color: '#ff0000', percent: 0 }],
      [{ color: '#ff0000', percent: 40 }],
      [
        { color: '#ff0000', percent: 80 },
        { name: 'grayscale', percent: 80 },
      ],
    ]) {
      const { read, catalogue } = await setup();
      expect(
        await Effect.runPromise(
          catalogue.search({ color: { mode: 'proportions', quality, targets } })
        )
      ).toMatchObject({ _tag: 'Found' });
      expect(read.selections[0]?.color?.targetCount).toBe(targets.length);
      expect(read.selections[0]?.color?.utilities[0]?.key).toContain(
        `_p${String(targets[0].percent).padStart(3, '0')}_`
      );
    }
  });
  it.each(COLOR_FEATURE_NAMES)('admits the named target %s', async (name) => {
    const { read, catalogue } = await setup();
    expect(
      await Effect.runPromise(catalogue.search({ color: { targets: [{ name }] } }))
    ).toMatchObject({ _tag: 'Found' });
    expect(read.selections[0]?.color?.targetCount).toBe(1);
  });
  it('preserves duplicate contributions by complete key and original target count', async () => {
    const { read, catalogue } = await setup();
    await Effect.runPromise(
      catalogue.search({
        color: {
          mode: 'proportions',
          targets: [
            { color: '#ff0000', percent: 20 },
            { color: '#fe0000', percent: 20 },
            { color: '#ff0000', percent: 60 },
          ],
        },
      })
    );
    expect(read.selections[0]?.color).toEqual({
      targetCount: 3,
      utilities: [
        { key: 'r0004_p020_q050_w1', multiplicity: 2 },
        { key: 'r0004_p060_q050_w1', multiplicity: 1 },
      ],
    });
  });
  it('admits ten targets and rejects caller-controlled work above that bound', async () => {
    const { read, catalogue } = await setup();
    const targets = Array.from({ length: 11 }, () => ({ name: 'dark' }));
    expect(await Effect.runPromise(catalogue.search({ color: { targets } }))).toMatchObject({
      _tag: 'InvalidSearch',
    });
    expect(read.selections).toEqual([]);
    expect(
      await Effect.runPromise(catalogue.search({ color: { targets: targets.slice(0, 10) } }))
    ).toMatchObject({ _tag: 'Found' });
  });
  it.each([
    { targets: [] },
    { targets: [{}] },
    { targets: [{ color: '#ff0000', name: 'red' }] },
    { targets: [{ color: '#f00' }] },
    { targets: [{ color: '#zz0000' }] },
    { targets: [{ name: 'unknown' }] },
    { targets: [{ color: '#ff0000', percent: 20 }] },
    ...[undefined, -10, 110, 15, Number.NaN, Infinity].map((percent) => ({
      mode: 'proportions' as const,
      targets: [{ color: '#ff0000', percent }],
    })),
  ] satisfies ColorQuery[])('rejects unsupported intent before reading %j', async (color) => {
    const { read, catalogue } = await setup();
    expect(await Effect.runPromise(catalogue.search({ color }))).toMatchObject({
      _tag: 'InvalidSearch',
    });
    expect(read.selections).toEqual([]);
  });
});

describe('Catalogue per-target color preferences', () => {
  it('mixes vibe and proportion utilities and preserves per-target quality and duplicate weight', async () => {
    const { read, catalogue } = await setup();
    const color: ColorQuery = {
      mode: 'proportions',
      quality: 'strict',
      targets: [
        { color: '#ff0000', mode: 'vibe', quality: 'relaxed' },
        { color: '#fe0000', mode: 'vibe', quality: 'relaxed' },
        { name: 'dark', percent: 0, quality: 'favorite' },
        { name: 'monochromatic', mode: 'proportions', percent: 40 },
      ],
    };
    expect(await Effect.runPromise(catalogue.search({ color }))).toMatchObject({ _tag: 'Found' });
    expect(read.selections[0]?.color).toEqual({
      targetCount: 4,
      utilities: [
        { key: 'r0004_v_q000_w0', multiplicity: 2 },
        { key: 'n_dark_p000_q050_w1', multiplicity: 1 },
        { key: 'n_monochromatic_p040_q100_w3', multiplicity: 1 },
      ],
    });
  });
  it.each([
    { color: '#ff0000', mode: 'vibe' as const, percent: 10 },
    { name: 'dark', mode: 'proportions' as const },
    { name: 'rainbow', mode: 'proportions' as const, percent: 15 },
  ])('rejects incompatible per-target mode and percent before reading %j', async (target) => {
    const { read, catalogue } = await setup();
    expect(
      await Effect.runPromise(catalogue.search({ color: { targets: [target] } }))
    ).toMatchObject({ _tag: 'InvalidSearch' });
    expect(read.selections).toEqual([]);
  });
});
