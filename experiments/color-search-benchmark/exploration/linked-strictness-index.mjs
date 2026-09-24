// THROWAWAY compact real-corpus indexer. New create-only indexes, no scale jobs.
// All score arithmetic is delegated to the unchanged favorite utility encoder.
import { mkdir, writeFile, appendFile, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { api, hash, safeIndexName } from './service.mjs';
import { loadHueDocuments } from './hue-index.mjs';
import { loadFavoriteScaleInputs } from './favorite-scale-corpus.mjs';
import { favoriteSourceSnapshot, settleFavoriteActivity } from './favorite-scale.mjs';
import { linkedStrictnessBank, linkedStrictnessMetadata, createLinkedStrictnessPlan } from './linked-strictness.mjs';
import { favoriteCompiledMapping, assertFavoriteCompiledMapping, sendFavoriteCompiledBulk } from './favorite-compiled-index.mjs';
import { compileFavoriteUtilityEncoder } from './favorite-compiled-encoder.mjs';
import { toFavoriteUtilityDocument } from './favorite-utilities.mjs';
import { favoriteUtilityBatcher } from './favorite-utility-index.mjs';
import { favoriteNumericAuditBatches, validateFavoriteNumericAuditBatch } from './favorite-numeric-index-audit.mjs';

const repository = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const atomicJson = async (filename, data) => { await writeFile(filename + '.tmp', JSON.stringify(data, null, 2)); await rename(filename + '.tmp', filename); };
export function linkedStrictnessIndexConfiguration(args = []) {
  const values = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (key === '--dry-run') { values.dryRun = true; continue; }
    if (!['--bank', '--index', '--directory'].includes(key) || !args[i + 1] || args[i + 1].startsWith('--')) throw Error('Use --bank, --index, --directory and optional --dry-run.');
    values[key.slice(2)] = args[++i];
  }
  const bank = linkedStrictnessBank(values.bank);
  if (!values.directory) throw Error('A new external --directory is required.');
  const directory = path.resolve(values.directory);
  if (directory === path.parse(directory).root || directory === repository || directory.startsWith(repository + path.sep)) throw Error('Keep linked indexing artifacts outside the worktree.');
  return { bankId: bank.id, index: safeIndexName(values.index ?? bank.index), directory, dryRun: values.dryRun ?? false,
    base: 'http://127.0.0.1:19216', mode: 'real', scope: 'full', count: 545, source: false, numericPoints: true,
    encodings: ['numeric'], presets: 'linked', bulkBytes: 5 * 1024 * 1024 };
}
export function linkedStrictnessMapping(plan) {
  return favoriteCompiledMapping(plan, { source: false, encodings: ['numeric'], numericPoints: true });
}
export function verifyLinkedStrictnessSource(documents, verified) {
  const receipt = verified.source.receipts.find(value => value.bucketCount === 256);
  if (documents.length !== 545 || new Set(documents.map(document => document.id)).size !== 545
    || hash(documents.map(document => ({ id: document.id, hash: hash(document) }))) !== receipt?.valuesHash) {
    throw Error('Linked indexes require the unchanged verified545-image measurement corpus.');
  }
}
export async function prepareLinkedStrictnessIndex(config, { loadInputs = loadFavoriteScaleInputs, loadDocuments = loadHueDocuments,
  snapshot = favoriteSourceSnapshot } = {}) {
  const verified = await loadInputs({ scope: 'full', bucketCount: 256 }), documents = await loadDocuments(256);
  verifyLinkedStrictnessSource(documents, verified);
  const plan = createLinkedStrictnessPlan(config.bankId), mapping = linkedStrictnessMapping(plan);
  const sourceSnapshot = await snapshot(import.meta.url);
  const source = { ...verified.source, selectedCount: documents.length, selectedDocumentsHash: hash(documents),
    selectedIdsHash: hash(documents.map(document => document.id)), selection: 'all545 original images including22 controlled fixtures' };
  const identity = { experiment: 'strict-hue-favorite-linked-utilities', version: 1, bankId: config.bankId, count: config.count,
    linkedStrictness: linkedStrictnessMetadata(config.bankId), planHash: hash(plan), mappingHash: hash(mapping), source,
    sourceHashes: Object.fromEntries(Object.entries(sourceSnapshot).map(([filename, text]) => [filename, hash(text)])) };
  const identityHash = hash(identity);
  mapping.mappings._meta = { experiment: 'strict-hue-favorite-utilities', utilityDefinitionVersion: 2, compiledEncoderVersion: 1,
    identityHash, planHash: identity.planHash, sourceIdentityHash: verified.identityHash, sourceDocumentsHash: source.selectedDocumentsHash,
    mode: 'real', scope: 'full', count: config.count, encodings: ['numeric'], presets: 'linked', numericPoints: true,
    utilities: plan.utilityCount, linkedStrictness: identity.linkedStrictness };
  return { documents, plan, mapping, source, sourceSnapshot, identity, identityHash, encode: compileFavoriteUtilityEncoder(plan, { encodings: ['numeric'] }) };
}
export async function runLinkedStrictnessIndex(config, { prepareIndex = prepareLinkedStrictnessIndex,
  request = (route, options) => api(route, { ...options, base: config.base }), snapshot = favoriteSourceSnapshot,
  settle = settleFavoriteActivity } = {}) {
  const prepared = await prepareIndex(config), { documents, plan, mapping, source, sourceSnapshot, identity, identityHash, encode } = prepared;
  if (config.dryRun) {
    const samples = documents.slice(0, 3).map(document => { const encoded = encode(document); return { id: document.id,
      utilities: Object.keys(encoded.utilities).length, bytes: Buffer.byteLength(JSON.stringify(encoded)), hash: hash(encoded) }; });
    return { dryRun: true, noServiceRequests: true, configuration: config, utilities: plan.utilityCount, source, identityHash, samples };
  }
  await mkdir(path.dirname(config.directory), { recursive: true });
  await mkdir(config.directory); // Never overwrite an earlier run or its evidence.
  const save = (name, value) => atomicJson(path.join(config.directory, name), value);
  const receipt = { schemaVersion: 1, experiment: identity.experiment, configuration: config, index: config.index, base: config.base,
    startedAt: new Date().toISOString(), identity, identityHash, source, sourceSnapshotHash: hash(sourceSnapshot), planHash: hash(plan),
    utilities: plan.utilityCount, generated: 0, indexed: 0, bulkCount: 0, serializedDocumentBytes: 0, bulkBytes: 0, encodingValueCounts: { numeric: 0 } };
  await save('plan.json', plan); await save('mapping-request.json', mapping); await save('source-snapshot.json', sourceSnapshot); await save('index.json', receipt);
  const started = performance.now(), digest = createHash('sha256'), idsDigest = createHash('sha256');
  try {
    receipt.creation = (await request(config.index, { method: 'PUT', body: mapping })).body;
    if (!receipt.creation.acknowledged) throw Error('Linked index creation was not acknowledged.');
    const batcher = favoriteUtilityBatcher({ maximumBytes: config.bulkBytes });
    const send = async batch => {
      const response = await sendFavoriteCompiledBulk({ index: config.index, batch, request, onEvent: async event => {
        // Record accepted count before evidence I/O so a failed write cannot erase it.
        if (event.phase === 'accepted') { receipt.indexed += event.acknowledged; receipt.bulkCount++; receipt.bulkBytes += batch.bytes; }
        await appendFile(path.join(config.directory, 'bulk-events.jsonl'), JSON.stringify(event) + '\n');
      } });
      await appendFile(path.join(config.directory, 'batches.jsonl'), JSON.stringify({ ordinal: receipt.bulkCount, documents: batch.ids.length,
        firstId: batch.ids[0], lastId: batch.ids.at(-1), bytes: batch.bytes, bodyHash: hash(batch.body), responseHash: hash(response.body) }) + '\n');
      await save('index.json', receipt);
    };
    for (const measured of documents) {
      const document = encode(measured), serialized = JSON.stringify(document), valueCount = Object.keys(document.utilities).length;
      if (valueCount !== plan.utilityCount) throw Error('A linked document is missing utility fields.');
      digest.update(serialized + '\n'); idsDigest.update(document.id + '\n'); receipt.generated++;
      receipt.serializedDocumentBytes += Buffer.byteLength(serialized); receipt.encodingValueCounts.numeric += valueCount;
      for (const batch of batcher.add(document)) await send(batch);
    }
    for (const batch of batcher.finish()) await send(batch);
    receipt.documentsHash = digest.digest('hex'); receipt.orderedIdsHash = idsDigest.digest('hex'); receipt.indexingFinishedAt = new Date().toISOString();
    await request(config.index + '/_flush?wait_if_ongoing=true', { method: 'POST', timeoutMs: 300000 });
    await request(config.index + '/_refresh', { method: 'POST' });
    const count = (await request(config.index + '/_count')).body;
    if (count.count !== config.count || count._shards?.failed || receipt.indexed !== config.count) throw Error('Linked index did not retain every545 corpus document.');
    const mget = (await request(config.index + '/_mget?_source=false', { method: 'POST', body: { ids: documents.map(document => document.id) } })).body.docs;
    if (mget?.length !== documents.length || mget.some((document, i) => !document.found || document.error || document._id !== documents[i].id)) throw Error('Linked index corpus IDs differ.');
    receipt.settling = await settle({ sample: async () => (await request('_nodes/stats/thread_pool,indices?filter_path=nodes.*.thread_pool.search,nodes.*.thread_pool.search_throttled,nodes.*.indices.search.query_current,nodes.*.indices.search.fetch_current,nodes.*.indices.merges.current')).body, timeoutMs: 600000 });
    if (!receipt.settling.settled) throw Error('Linked index activity failed to settle.');
    const actualMapping = (await request(config.index + '/_mapping')).body;
    assertFavoriteCompiledMapping(actualMapping[config.index]?.mappings, mapping.mappings);
    const settings = (await request(config.index + '/_settings')).body;
    receipt.uuid = settings[config.index]?.settings?.index?.uuid;
    if (!receipt.uuid) throw Error('Linked index UUID is missing.');
    const before = (await request(config.index + '/_stats/docs,indexing')).body;
    const sampleOrdinals = [0, Math.floor((documents.length - 1) / 2), documents.length - 1];
    const samples = sampleOrdinals.map(ordinal => toFavoriteUtilityDocument(documents[ordinal], plan, { encodings: ['numeric'] }));
    receipt.sampleAudit = { verified: false, ordinals: sampleOrdinals, valuesCompared: 0, utilitiesPerSample: plan.utilityCount,
      limitation: 'Every field on three documents is checked using the original encoder; this is not an all-document value audit.' };
    await save('expected-samples.json', samples);
    for (const batch of favoriteNumericAuditBatches(samples)) {
      const result = (await request(config.index + '/_search?request_cache=false', { method: 'POST', body: batch.body, timeoutMs: 35000 })).body;
      await appendFile(path.join(config.directory, 'value-audit.jsonl'), JSON.stringify({ ordinal: batch.ordinal, request: batch.body, response: result }) + '\n');
      receipt.sampleAudit.valuesCompared += validateFavoriteNumericAuditBatch(result, batch, samples, config.index).valuesCompared;
    }
    const after = (await request(config.index + '/_stats/docs,indexing')).body;
    const generation = state => { const index = state.indices?.[config.index], p = index?.primaries;
      return [index?.uuid, p?.docs?.count, p?.docs?.deleted, p?.indexing?.index_total, p?.indexing?.delete_total]; };
    const beforeGeneration = generation(before), afterGeneration = generation(after);
    if (beforeGeneration[0] !== receipt.uuid || beforeGeneration[1] !== config.count || beforeGeneration.slice(1).some(value => !Number.isSafeInteger(value))
      || hash(beforeGeneration) !== hash(afterGeneration)) throw Error('Linked index generation changed during its value audit.');
    if (receipt.sampleAudit.valuesCompared !== samples.length * plan.utilityCount) throw Error('Linked value audit is incomplete.');
    receipt.sampleAudit.verified = true; receipt.count = count.count;
    receipt.after = { at: new Date().toISOString(), mapping: actualMapping, settings,
      stats: (await request(config.index + '/_stats/store,docs,segments,merge,translog')).body, generation: afterGeneration };
    if (hash(await snapshot(import.meta.url)) !== receipt.sourceSnapshotHash) throw Error('Linked index sources changed while building.');
    receipt.finishedAt = new Date().toISOString(); receipt.elapsedMs = performance.now() - started;
    await save('index.json', receipt); return receipt;
  } catch (error) {
    receipt.error = String(error.stack ?? error); receipt.interruptedAt = new Date().toISOString(); receipt.elapsedMs = performance.now() - started;
    await save('index.json', receipt); throw error;
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await runLinkedStrictnessIndex(linkedStrictnessIndexConfiguration(process.argv.slice(2)));
  console.log(JSON.stringify(result.dryRun ? result : { index: result.index, count: result.count, utilities: result.utilities,
    verified: result.sampleAudit.verified, elapsedMs: result.elapsedMs }, null, 2));
}
