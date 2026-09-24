// Adds only the independently extracted rel_* fields to the existing scratch index.
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { api, safeIndexName, CORPUS_STORE, INDEX, loadExpandedCorpus } from './service.mjs';
import { extractRelativeLightnessFeatures } from './refinement-features.mjs';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const FIELDS = Object.freeze(['rel_sample_width', 'rel_sample_height', ...Object.keys(extractRelativeLightnessFeatures([0]))]);

function relativeFields(record) {
  for (const key of Object.keys(record)) if (!['id', 'sha256', ...FIELDS].includes(key)) throw new Error(`Refinement sidecar contains an unexpected field: ${key}`);
  return Object.fromEntries(FIELDS.map((field) => {
    if (!Number.isFinite(record[field])) throw new Error(`Missing or invalid relative feature: ${record.id}/${field}`);
    return [field, record[field]];
  }));
}

export function validateRefinementSidecar({ corpus, bytes, manifest }) {
  if (hash(bytes) !== manifest.sha256) throw new Error('Refinement artifact hash differs from its manifest.');
  const records = bytes.toString().trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
  if (records.length !== manifest.count || records.length !== corpus.length) throw new Error('Refinement count must equal the entire corpus coverage.');
  const sources = new Map(corpus.map((asset) => [asset.id, asset]));
  const seen = new Set();
  for (const record of records) {
    if (!sources.has(record.id) || seen.has(record.id)) throw new Error(`Invalid or repeated refinement ID: ${record.id}`);
    if (record.sha256 !== sources.get(record.id).sha256) throw new Error(`Refinement source hash differs from the corpus: ${record.id}`);
    relativeFields(record);
    seen.add(record.id);
  }
  if (seen.size !== sources.size) throw new Error('Incomplete refinement corpus coverage.');
  return records;
}

export function refinementMapping(record) {
  return { properties: Object.fromEntries(Object.keys(relativeFields(record)).map((field) => [field, { type: 'float' }])) };
}

export function refinementUpdateBody(records) {
  return records.map((record) => `${JSON.stringify({ update: { _id: record.id } })}\n${JSON.stringify({ doc: relativeFields(record) })}\n`).join('');
}

export async function indexRefinementFeatures({ index = INDEX, store = CORPUS_STORE, corpus, request = api } = {}) {
  safeIndexName(index);
  corpus ??= await loadExpandedCorpus();
  const [bytes, manifestBytes] = await Promise.all([
    readFile(path.join(store, 'refinement-features.jsonl')),
    readFile(path.join(store, 'refinement-features-manifest.json')),
  ]);
  const manifest = JSON.parse(manifestBytes);
  const records = validateRefinementSidecar({ corpus, bytes, manifest });
  const existing = await request(`${index}/_mget?_source=false`, { method: 'POST', body: { ids: records.map((record) => record.id) } });
  if (existing.body.docs.length !== records.length || existing.body.docs.some((record) => !record.found || record.error)) throw new Error('Every refinement source must already exist in the target index.');
  await request(`${index}/_mapping`, { method: 'PUT', body: refinementMapping(records[0]) });
  let updated = 0;
  for (let start = 0; start < records.length; start += 100) {
    const batch = records.slice(start, start + 100);
    const response = await request(`${index}/_bulk`, { method: 'POST', body: refinementUpdateBody(batch) });
    if (response.body.errors) throw new Error(`Refinement update failed: ${JSON.stringify(response.body.items.filter((item) => item.update.error).slice(0, 2))}`);
    updated += batch.length;
  }
  await request(`${index}/_refresh`, { method: 'POST' });
  const verification = await request(`${index}/_count`, { method: 'POST', body: { query: { bool: { filter: [{ ids: { values: records.map((record) => record.id) } }, { exists: { field: 'rel_pixel_total' } }] } } } });
  if (verification.body.count !== records.length) throw new Error('Refinement indexed count verification failed.');
  const receipt = { createdAt: new Date().toISOString(), index, updated, sidecarSha256: manifest.sha256, fields: FIELDS, indexedCount: verification.body.count };
  await writeFile(path.join(store, 'refinement-index-receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`);
  return receipt;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) console.log(JSON.stringify(await indexRefinementFeatures(), null, 2));
