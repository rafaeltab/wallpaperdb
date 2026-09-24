// Read-only real OpenSearch validation; no application ranking or index writes.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { api, hash, loadExpandedCorpus, searchIndex } from './service.mjs';
import { LINKED_STRICTNESS_BANKS, linkedStrictnessSelection } from './linked-strictness.mjs';
import { searchFavoriteDocvalueUtilities } from './favorite-docvalue-fetch.mjs';
import { buildCutoffQuery } from './methods-cutoff.mjs';

const queries = [
  { id: 'red', query: { mode: 'vibe', targets: [{ color: '#ff0000' }] } },
  { id: 'green40', query: { mode: 'proportions', targets: [{ color: '#22cc44', percent: 40 }] } },
  { id: 'two-colors', query: { mode: 'proportions', targets: [{ color: '#ff0000', percent: 50 }, { color: '#22cc44', percent: 50 }] } },
  { id: 'gray-red', query: { mode: 'proportions', targets: [{ name: 'grayscale', percent: 80 }, { color: '#ff0000', percent: 20 }] } },
  { id: 'dark', query: { mode: 'vibe', targets: [{ name: 'dark' }] } },
  { id: 'five-colors', query: { mode: 'proportions', targets: ['#ff2200', '#ff8800', '#ffff00', '#22cc44', '#2266ff'].map(color => ({ color, percent: 20 })) } },
];
const directory = path.resolve(process.argv[2] ?? '');
const repository = fileURLToPath(new URL('../../../', import.meta.url));
if (!process.argv[2] || directory === path.parse(directory).root || directory.startsWith(repository)) throw Error('Provide a fresh external evidence directory.');
await mkdir(directory, { recursive: false });
const assets = await loadExpandedCorpus(), real = assets.filter(asset => asset.cohort !== 'controlled-fixture' && !asset.filename.endsWith('.svg'));
const allowed = new Set(real.map(asset => asset.id)), excludedIds = assets.filter(asset => !allowed.has(asset.id)).map(asset => asset.id);
if (assets.length !== 545 || allowed.size !== 523 || excludedIds.length !== 22) throw Error('Expected unchanged real corpus.');
const parent = 'color-exploration-favorite-points-real-v2', original = 'color-exploration-shade-hue-256-real-v1';
const indices = [parent, original, ...LINKED_STRICTNESS_BANKS.map(bank => bank.index)];
async function fingerprints() {
  const values = {};
  for (const index of indices) {
    values[index] = (await api(`${index}/_stats/docs,indexing?filter_path=indices.*.uuid,indices.*.primaries.docs,indices.*.primaries.indexing.index_total,indices.*.primaries.indexing.delete_total`)).body;
  }
  return values;
}
const results = { startedAt: new Date().toISOString(), before: await fingerprints(), records: [],
  scope: '523 real wallpapers in each ranking; 545 indexed assets. Small-corpus correctness, not scale capacity.',
  expectedParent: 'Exact numeric precomputation score/order parity.',
  expectedOriginal: 'Same formula; rounding can change close ties. Compare per-ID scores with absolute tolerance5e-7.' };
await writeFile(path.join(directory, 'source.mjs'), await (await import('node:fs/promises')).readFile(fileURLToPath(import.meta.url)));
try {
  for (const bank of LINKED_STRICTNESS_BANKS) for (let stepIndex = 0; stepIndex < bank.steps.length; stepIndex++) for (const item of queries) {
    const parameters = linkedStrictnessSelection({ bankId: bank.id, stepIndex });
    const options = { query: item.query, parameters, excludedIds, limit: 523, timeoutMs: 30000 };
    const candidate = await searchFavoriteDocvalueUtilities({ ...options, index: bank.index });
    const reference = await searchFavoriteDocvalueUtilities({ ...options, index: parent });
    const baseline = await searchIndex(original, buildCutoffQuery({ ...options, method: 'cutoff-shade-hue-all-levels' }), { timeoutMs: 30000 });
    for (const result of [candidate, reference, baseline]) if (result.hits.length !== 523 || new Set(result.hits.map(hit => hit.id)).size !== 523 || result.hits.some(hit => !allowed.has(hit.id))) throw Error('A comparison omitted real images or admitted fixtures.');
    const exactParent = hash(candidate.hits) === hash(reference.hits), originalScores = new Map(baseline.hits.map(hit => [hit.id, hit.score]));
    const maximumOriginalDifference = Math.max(...candidate.hits.map(hit => Math.abs(hit.score - originalScores.get(hit.id))));
    const row = { bankId: bank.id, stepIndex, parameters, queryId: item.id, query: item.query,
      exactParent, maximumOriginalDifference, exactOriginalOrder: candidate.hits.every((hit, i) => hit.id === baseline.hits[i].id),
      candidate, reference, baseline };
    results.records.push(row);
    await writeFile(path.join(directory, 'verification.json'), JSON.stringify(results));
    if (!exactParent || maximumOriginalDifference > 5e-7) throw Error('Linked ranking differs from its recorded objective: ' + bank.id + '/' + item.id);
  }
  results.after = await fingerprints();
  if (hash(results.before) !== hash(results.after)) throw Error('Index generation changed during comparison.');
  results.finishedAt = new Date().toISOString(); results.passed = true;
} catch (error) { results.error = String(error.stack ?? error); results.passed = false; throw error; }
finally { await writeFile(path.join(directory, 'verification.json'), JSON.stringify(results)); }
console.log(JSON.stringify({ passed: results.passed, comparisons: results.records.length,
  maximumOriginalDifference: Math.max(...results.records.map(row => row.maximumOriginalDifference)),
  exactOriginalOrders: results.records.filter(row => row.exactOriginalOrder).length, directory }));
