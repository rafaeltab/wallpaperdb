// Offline correctness probe: actual search order comes only from OpenSearch.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { CORPUS_STORE, INDEX, searchIndex } from './service.mjs';
import { buildRelativeQuery, relativeContrastReference } from './methods-relative.mjs';

const records = (await readFile(path.join(CORPUS_STORE, 'refinement-features.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
const features = new Map(records.map((record) => [record.id, record]));
const query = { mode: 'vibe', targets: [{ name: 'dark' }, { name: 'bright' }] };
const result = await searchIndex(INDEX, buildRelativeQuery({ query, limit: records.length }));
assert.equal(result.hits.length, records.length);
let maximumError = 0;
for (const hit of result.hits) {
  const feature = features.get(hit.id);
  const indexed = Object.fromEntries(Object.entries(feature).map(([key, value]) => [key, key.startsWith('rel_') ? Math.fround(value) : value]));
  const expected = Math.fround(relativeContrastReference(indexed));
  maximumError = Math.max(maximumError, Math.abs(hit.score - expected));
  assert.ok(Math.abs(hit.score - expected) < 1e-6, `Service score mismatch for ${hit.id}`);
}
const judgedIds = new Set(['wallpaper-005', 'wallpaper-022', 'wallpaper-032', 'wallpaper-015']);
const filtered = await searchIndex(INDEX, buildRelativeQuery({ query, limit: 10, eligibleIds: [...judgedIds], excludedIds: ['wallpaper-015'] }));
assert.equal(filtered.hits.length, 3);
assert.ok(filtered.hits.every((hit) => judgedIds.has(hit.id) && hit.id !== 'wallpaper-015'));
console.log(JSON.stringify({ index: INDEX, checkedDocuments: records.length, maximumScoreError: maximumError, evidence: result.evidence,
  previouslyJudgedOrder: result.hits.filter((hit) => judgedIds.has(hit.id)), hardFilterResult: filtered.hits,
  note: 'Correctness probe only. Existing judged-order display is diagnostic, not a new label or a performance benchmark.' }, null, 2));
