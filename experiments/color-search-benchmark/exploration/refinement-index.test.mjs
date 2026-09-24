import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { validateRefinementSidecar, refinementMapping, refinementUpdateBody } from './refinement-index.mjs';
import { extractRelativeLightnessFeatures } from './refinement-features.mjs';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const corpus = [{ id: 'a', sha256: 'a'.repeat(64) }, { id: 'b', sha256: 'b'.repeat(64) }];
const documents = corpus.map((asset) => ({ ...asset, rel_sample_width: 512, rel_sample_height: 512, ...extractRelativeLightnessFeatures([0.1, 0.2, 0.3]) }));
const bytes = Buffer.from(documents.map((record) => JSON.stringify(record)).join('\n') + '\n');
const manifest = { count: 2, sha256: hash(bytes) };

test('sidecar validation requires exact coverage, verified sources, and unchanged artifact bytes', () => {
  assert.deepEqual(validateRefinementSidecar({ corpus, bytes, manifest }), documents);
  assert.throws(() => validateRefinementSidecar({ corpus: corpus.slice(0, 1), bytes, manifest }), /count|coverage/);
  assert.throws(() => validateRefinementSidecar({ corpus: [{ ...corpus[0], sha256: 'c'.repeat(64) }, corpus[1]], bytes, manifest }), /source hash/);
  assert.throws(() => validateRefinementSidecar({ corpus, bytes: Buffer.concat([bytes, Buffer.from(' ')]), manifest }), /artifact hash/);
});

test('mapping is explicit float and update payload changes only relative fields', () => {
  const mapping = refinementMapping(documents[0]);
  assert.ok(Object.keys(mapping.properties).length > 10);
  for (const [key, value] of Object.entries(mapping.properties)) {
    assert.match(key, /^rel_/);
    assert.deepEqual(value, { type: 'float' });
  }
  const lines = refinementUpdateBody(documents).trim().split('\n').map(JSON.parse);
  assert.deepEqual(lines[0], { update: { _id: 'a' } });
  assert.ok(!('sha256' in lines[1].doc));
  assert.ok(!('id' in lines[1].doc));
  assert.deepEqual(Object.keys(lines[1].doc).sort(), Object.keys(mapping.properties).sort());
  assert.throws(() => refinementUpdateBody([{ ...documents[0], cov_red: 50 }]), /unexpected field/);
});
