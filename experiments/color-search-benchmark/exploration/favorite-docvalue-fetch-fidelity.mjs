// Diagnostic only. Compare service rankings and fetch paths without reranking.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { api, BASE, hash, searchIndex } from './service.mjs';
import { favoriteSourceSnapshot } from './favorite-scale.mjs';
import { FIDELITY_QUERIES } from './favorite-optimization-fidelity.mjs';
import { FAVORITE_PARAMETERS } from './favorite-scale-corpus.mjs';
import { buildFavoriteUtilityQuery } from './favorite-utilities.mjs';
import { buildFavoritePrecisionQuery } from './favorite-precision-utilities.mjs';
import { searchFavoriteSortedUtilities, buildFavoriteSortedQuery } from './favorite-sorted-utilities.mjs';
import { buildFavoriteDocvalueQuery, searchFavoriteDocvalueUtilities } from './favorite-docvalue-fetch.mjs';

const repository = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const variants = [
  { id: 'favorite-utility-numeric-docvalues', parent: 'favorite-utility-numeric', index: 'color-exploration-favorite-opt-real-v4', reference: 'numeric', builder: buildFavoriteUtilityQuery },
  { id: 'favorite-utility-rank27-docvalues', parent: 'favorite-utility-rank27', index: 'color-exploration-favorite-precision-real-v1', reference: 'precision', builder: buildFavoritePrecisionQuery },
  { id: 'favorite-utility-sorted-docvalues', parent: 'favorite-utility-sorted', index: 'color-exploration-favorite-points-real-v2', reference: 'numeric', builder: buildFavoriteSortedQuery },
];
const key = row => JSON.stringify([row.queryId, row.parameters.qualityInfluence, row.parameters.cutoffBlendExponent]);
const comparable = hits => hits.map(hit => ({ id: hit.id, score: Math.fround(hit.score) }));
const strippedFetch = ({ stored_fields, docvalue_fields, ...body }) => body;

async function fingerprint(index) {
  const [count, mapping, statistics] = await Promise.all([
    api(`${index}/_count`), api(`${index}/_mapping`), api(`${index}/_stats/docs,indexing`),
  ]);
  const stats = statistics.body.indices[index], meta = mapping.body[index].mappings._meta;
  assert.equal(count.body.count, 545);
  assert.equal(meta.mode, 'real'); assert.equal(meta.scope, 'full'); assert.equal(meta.presets, 'all');
  assert.ok(stats.uuid && meta.sourceDocumentsHash && meta.sourceIdentityHash);
  return { index, uuid: stats.uuid, count: count.body.count, metadata: meta, mappingHash: hash(mapping.body),
    indexingTotal: stats.primaries.indexing.index_total, deleteTotal: stats.primaries.indexing.delete_total };
}

export async function runFavoriteDocvalueFetchFidelity({ directory, numericReference, precisionReference }) {
  directory = path.resolve(directory);
  assert.ok(directory !== path.parse(directory).root && directory !== repository && !directory.startsWith(repository + path.sep), 'Use a new external artifact directory.');
  assert.equal(BASE, 'http://127.0.0.1:19216');
  await mkdir(path.dirname(directory), { recursive: true }); await mkdir(directory);
  const save = (name, value) => writeFile(path.join(directory, name), JSON.stringify(value, null, 2), { flag: 'wx' });
  const append = (name, value) => appendFile(path.join(directory, name), JSON.stringify(value) + '\n');
  const result = { schemaVersion: 1, startedAt: new Date().toISOString(), directory, variants: variants.map(({ builder, ...row }) => row), rows: [], diagnostics: [],
    limitations: ['Tests transport fidelity, not human relevance.', 'Alternating same-index fetch timings are diagnostics on545 assets, not concurrent-load or million-document capacity measurements.',
      'Archived numeric comparisons originated from the equivalent older utility index; current same-index A/B checks supplement these all-preset comparisons.'] };
  try {
    const sources = await favoriteSourceSnapshot(import.meta.url);
    result.sourceSnapshotHash = hash(sources); await save('source-snapshot.json', sources);
    const references = {};
    for (const [name, filename] of Object.entries({ numeric: numericReference, precision: precisionReference })) {
      const bytes = await readFile(filename, 'utf8'), rows = bytes.trim().split('\n').map(line => JSON.parse(line));
      const receiptFile = path.join(path.dirname(filename), 'fidelity.json'), receiptBytes = await readFile(receiptFile, 'utf8'), receipt = JSON.parse(receiptBytes);
      assert.ok(receipt.finishedAt && receipt.passed === true && !receipt.error, `${name} reference must have passed.`);
      assert.deepEqual(receipt.queries, FIDELITY_QUERIES, 'Archived query definitions differ.');
      assert.equal(rows.length, 144); assert.equal(new Set(rows.map(key)).size, 144);
      references[name] = new Map(rows.map(row => [key(row), row]));
      (result.references ??= {})[name] = { filename: path.resolve(filename), sha256: hash(bytes), receiptFile, receiptSha256: hash(receiptBytes),
        documentValuesHash: receipt.documentValuesHash, sourceIdentityHash: receipt.sourceIdentityHash };
      await save(`reference-${name}.json`, { receipt, rows });
    }
    const before = {};
    for (const variant of variants) before[variant.index] = await fingerprint(variant.index);
    assert.equal(new Set(Object.values(before).map(row => row.metadata.sourceDocumentsHash)).size, 1);
    for (const reference of Object.values(result.references)) for (const current of Object.values(before)) {
      assert.equal(reference.documentValuesHash, current.metadata.sourceDocumentsHash, 'Reference measurement identity differs.');
      assert.equal(reference.sourceIdentityHash, current.metadata.sourceIdentityHash, 'Reference source identity differs.');
    }
    result.before = before; await save('index-before.json', before);
    for (const row of references.numeric.values()) {
      const query = FIDELITY_QUERIES.find(item => item.id === row.queryId)?.query;
      assert.ok(query, 'Unknown archived query.');
      for (const variant of variants) {
        const reference = references[variant.reference].get(key(row)); assert.ok(reference);
        assert.deepEqual(reference.parameters, row.parameters, 'Archived query parameters differ.');
        const referenceMethod = variant.reference === 'precision' ? 'favorite-utility-rank27' : 'favorite-utility-numeric';
        const expected = reference.rankings[referenceMethod];
        assert.equal(expected.length, 545); assert.equal(new Set(expected.map(hit => hit.id)).size, 545);
        const options = { index: variant.index, method: variant.id, query, parameters: row.parameters, limit: 1000, timeoutMs: 10000 };
        const body = buildFavoriteDocvalueQuery(options), parentBody = variant.builder({ ...options, method: variant.parent });
        assert.deepEqual(strippedFetch(body), parentBody, 'Fetch refinement changed scoring/filter/sort.');
        const evidence = { queryId: row.queryId, parameters: row.parameters, method: variant.id, index: variant.index, request: body };
        await append('requests.jsonl', evidence);
        const actual = await searchFavoriteDocvalueUtilities(options);
        await append('rankings.jsonl', { ...evidence, expected, actual });
        assert.deepEqual(comparable(actual.hits), comparable(expected), 'Docvalue fetching changed ranking or score.');
        result.rows.push({ queryId: row.queryId, parameters: row.parameters, method: variant.id, count: actual.hits.length, identicalFloat32ScoresAndIds: true,
          rawScoresIdentical: actual.hits.every((hit, i) => hit.score === expected[i].score), evidence: actual.evidence });
      }
      await append('progress.jsonl', { at: new Date().toISOString(), completedComparisons: result.rows.length, queryId: row.queryId, parameters: row.parameters });
    }
    // The same-index A/B diagnostic alternates fetch order across query/limits.
    for (const [ordinal, item] of FIDELITY_QUERIES.slice(0, 4).entries()) for (const variant of variants) for (const limit of [20, 1000]) {
      const parameters = { ...FAVORITE_PARAMETERS, bucketCount: 256 }, records = {};
      const options = { index: variant.index, query: item.query, parameters, limit, timeoutMs: 10000 };
      for (const fetch of ((ordinal + (limit === 20 ? 0 : 1)) % 2 ? ['docvalues', 'stored'] : ['stored', 'docvalues'])) {
        const started = performance.now();
        const response = fetch === 'docvalues' ? await searchFavoriteDocvalueUtilities({ ...options, method: variant.id })
          : variant.parent === 'favorite-utility-sorted' ? await searchFavoriteSortedUtilities({ ...options, method: variant.parent })
            : await searchIndex(variant.index, variant.builder({ ...options, method: variant.parent }), { timeoutMs: options.timeoutMs });
        records[fetch] = { elapsedMs: performance.now() - started, ...response };
        await append('diagnostics.jsonl', { queryId: item.id, method: variant.id, index: variant.index, limit, fetch, ...records[fetch] });
      }
      assert.deepEqual(comparable(records.docvalues.hits), comparable(records.stored.hits));
      result.diagnostics.push({ queryId: item.id, method: variant.id, index: variant.index, limit, identicalFloat32ScoresAndIds: true,
        stored: { elapsedMs: records.stored.elapsedMs, ...records.stored.evidence }, docvalues: { elapsedMs: records.docvalues.elapsedMs, ...records.docvalues.evidence } });
    }
    result.after = {};
    for (const variant of variants) result.after[variant.index] = await fingerprint(variant.index);
    assert.deepEqual(result.after, before, 'Index generation changed.');
    assert.equal(hash(await favoriteSourceSnapshot(import.meta.url)), result.sourceSnapshotHash, 'Source graph changed.');
    assert.equal(result.rows.length, 432); assert.equal(result.diagnostics.length, 24);
    result.finishedAt = new Date().toISOString(); result.passed = true;
    await save('fidelity.json', result); return result;
  } catch (error) {
    result.error = String(error.stack ?? error); result.interruptedAt = new Date().toISOString();
    await save('failure.json', result); throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const values = {};
  for (let i = 2; i < process.argv.length; i++) {
    const option = process.argv[i], value = process.argv[++i];
    assert.ok(['--directory', '--numeric-reference', '--precision-reference'].includes(option) && value && !value.startsWith('--'));
    values[option] = value;
  }
  assert.equal(Object.keys(values).length, 3, 'Provide --directory, --numeric-reference and --precision-reference.');
  const result = await runFavoriteDocvalueFetchFidelity({ directory: values['--directory'], numericReference: values['--numeric-reference'], precisionReference: values['--precision-reference'] });
  console.log(JSON.stringify({ directory: result.directory, comparisons: result.rows.length, diagnostics: result.diagnostics.length, passed: result.passed }));
}
