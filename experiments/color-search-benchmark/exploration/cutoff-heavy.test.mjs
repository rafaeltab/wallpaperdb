import test from 'node:test';
import assert from 'node:assert/strict';
import { cutoffHeavyConfiguration, cutoffHeavyVariants, mainSerialFailed } from './cutoff-heavy.mjs';

test('dedicated heavy-query defaults produce all eight requested variants and at least32 requests', () => {
  const config = cutoffHeavyConfiguration(), variants = cutoffHeavyVariants(config);
  assert.equal(config.requests, 32);
  assert.deepEqual(config.concurrencies, [1, 4, 16]);
  assert.equal(variants.length, 8);
  assert.equal(new Set(variants.map(variant => variant.id)).size, 8);
  assert.ok(variants.every(variant => variant.parameters.pixelCutoff === .5 && [256, 1024].includes(variant.parameters.bucketCount)));
  for (const args of [['--requests', '31'], ['--requests', '257'], ['--concurrency', '16,1'], ['--bucket-counts', '16'], ['--requests'], ['--typo', '1']]) assert.throws(() => cutoffHeavyConfiguration(args));
});

test('higher-concurrency skip checks the exact variant and million-document serial profile', () => {
  const variant = { id: 'hard-b256-q50' }, failed = { variant: variant.id, count: 1000000, concurrency: 1, viableAtTestedLoad: false };
  assert.equal(mainSerialFailed({ profiles: [failed] }, variant), true);
  for (const patch of [{ variant: 'other' }, { count: 100000 }, { concurrency: 16 }, { viableAtTestedLoad: true }]) assert.equal(mainSerialFailed({ profiles: [{ ...failed, ...patch }] }, variant), false);
});
