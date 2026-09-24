// Read-only completion of the original real corpus indexing receipt. The failed
// receipt and source archive remain unchanged; this creates separate evidence.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { api, hash, safeIndexName } from './service.mjs';
import { loadHueDocuments } from './hue-index.mjs';
import { loadFavoriteScaleInputs } from './favorite-scale-corpus.mjs';
import { favoriteSourceSnapshot } from './favorite-scale.mjs';
import { favoriteUtilityMapping, toFavoriteUtilityDocument } from './favorite-utilities.mjs';
import { assertFavoriteUtilityMapping, sameUtilityValue } from './favorite-utility-mapping.mjs';

const experimentRoot = fileURLToPath(new URL('../', import.meta.url));
const repository = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)));

export function favoriteUtilityCompletionConfiguration(args = []) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i], value = args[++i];
    if (!['--receipt', '--directory'].includes(key) || !value || value.startsWith('--')) throw Error('Use --receipt existing-index.json --directory new-output-directory.');
    if (options[key.slice(2)]) throw Error('Repeated completion option.');
    options[key.slice(2)] = path.resolve(value);
  }
  if (!options.receipt || !options.directory) throw Error('Provide --receipt and --directory.');
  if (options.directory === path.parse(options.directory).root || options.directory === repository || options.directory.startsWith(repository + path.sep)) throw Error('Keep completion artifacts outside the worktree.');
  return options;
}

export function validateUtilityCompletionArtifacts({ receipt, plan, mapping, snapshot }) {
  if (receipt.experiment !== 'strict-hue-favorite-utilities' || receipt.configuration?.mode !== 'real'
    || receipt.configuration?.count !== 545 || receipt.indexed !== 545 || receipt.configuration?.source !== true
    || !receipt.error?.startsWith('Error: Utility mapping differs after indexing beyond default _source.enabled serialization.')) throw Error('Receipt is not the complete original real-corpus indexing attempt with the known mapping guard failure.');
  if (receipt.base !== 'http://127.0.0.1:19216' || receipt.configuration.base !== receipt.base) throw Error('Completion only reads the isolated real OpenSearch service.');
  safeIndexName(receipt.index);
  if (receipt.configuration.index !== receipt.index || hash(receipt.identity) !== receipt.identityHash) throw Error('Receipt identity mismatch.');
  if (hash(plan) !== receipt.planHash || receipt.identity.planHash !== receipt.planHash) throw Error('Saved utility plan changed.');
  if (hash(snapshot) !== receipt.sourceSnapshotHash || !sameUtilityValue(Object.fromEntries(Object.entries(snapshot).map(([name, source]) => [name, hash(source)])), receipt.identity.sourceHashes)) throw Error('Saved source snapshot changed.');
  const { _meta, ...plainMapping } = mapping.mappings;
  if (hash({ ...mapping, mappings: plainMapping }) !== receipt.identity.mappingHash || _meta?.identityHash !== receipt.identityHash || _meta?.planHash !== receipt.planHash
    || _meta?.sourceDocumentsHash !== receipt.source.selectedDocumentsHash || _meta?.count !== 545) throw Error('Saved mapping identity mismatch.');
  if (!sameUtilityValue(receipt.source, receipt.identity.source)) throw Error('Receipt source identity mismatch.');
}

async function verifyCurrentSources(snapshot) {
  const actual = {};
  for (const [name, source] of Object.entries(snapshot)) {
    const filename = path.resolve(experimentRoot, name);
    if (!filename.startsWith(experimentRoot)) throw Error('Archived source path escapes experiment.');
    actual[name] = await readFile(filename, 'utf8');
    if (actual[name] !== source) throw Error('Original indexing source changed before completion: ' + name);
  }
  return { count: Object.keys(actual).length, hash: hash(actual), verifiedAt: new Date().toISOString() };
}

export async function completeFavoriteUtilityIndex(config) {
  const originalText = await readFile(config.receipt, 'utf8'), receipt = JSON.parse(originalText), originalDirectory = path.dirname(config.receipt);
  const readArtifact = async name => JSON.parse(await readFile(path.join(originalDirectory, name), 'utf8'));
  const [plan, mapping, snapshot] = await Promise.all(['plan.json', 'mapping-request.json', 'source-snapshot.json'].map(readArtifact));
  validateUtilityCompletionArtifacts({ receipt, plan, mapping, snapshot });
  const sources = await verifyCurrentSources(snapshot);
  const recomputedMapping = favoriteUtilityMapping(plan, { source: true, encodings: receipt.configuration.encodings });
  const { _meta, ...savedPlainMapping } = mapping.mappings;
  if (!sameUtilityValue(recomputedMapping, { ...mapping, mappings: savedPlainMapping })) throw Error('Current utility mapping definition differs from saved request.');
  const verified = await loadFavoriteScaleInputs({ scope: 'full', bucketCount: 256 });
  const documents = await loadHueDocuments(256);
  const originalValues = verified.source.receipts.find(row => row.bucketCount === 256);
  if (documents.length !== 545 || new Set(documents.map(doc => doc.id)).size !== 545
    || hash(documents.map(doc => ({ id: doc.id, hash: hash(doc) }))) !== originalValues?.valuesHash
    || hash(documents) !== receipt.source.selectedDocumentsHash
    || hash(documents.map(doc => doc.id)) !== receipt.source.selectedIdsHash
    || verified.identityHash !== _meta.sourceIdentityHash) throw Error('The measured all545 source corpus no longer matches the original receipt.');
  await mkdir(path.dirname(config.directory), { recursive: true });
  await mkdir(config.directory); // Never overwrite original or completed evidence.
  const request = route => api(route, { base: receipt.base });
  const [mappingResponse, settingsResponse, countResponse, statsResponse, segmentsResponse] = await Promise.all([
    request(receipt.index + '/_mapping'), request(receipt.index + '/_settings'), request(receipt.index + '/_count'),
    request(receipt.index + '/_stats/store,docs,segments,merge,translog'), request(receipt.index + '/_segments'),
  ]);
  const actualMapping = mappingResponse.body[receipt.index]?.mappings;
  assertFavoriteUtilityMapping(actualMapping, mapping.mappings);
  const uuid = settingsResponse.body[receipt.index]?.settings?.index?.uuid;
  if (!uuid || (receipt.uuid && uuid !== receipt.uuid)) throw Error('Index UUID missing or changed.');
  if (countResponse.body.count !== 545) throw Error('Completed utility index must retain all545 documents.');
  const ordinals = [0, 272, 544];
  const samples = ordinals.map(ordinal => toFavoriteUtilityDocument(documents[ordinal], plan, { encodings: receipt.configuration.encodings }));
  // POST _mget is read-only and avoids retrieving the other542 large sources.
  const actualSamples = (await api(receipt.index + '/_mget', { base: receipt.base, method: 'POST', body: { ids: samples.map(doc => doc.id) } })).body.docs;
  if (actualSamples?.length !== samples.length || actualSamples.some((doc, i) => !doc.found || doc._index !== receipt.index || doc._id !== samples[i].id || !sameUtilityValue(doc._source, samples[i]))) throw Error('Stored utility sample values differ from recomputation.');
  const finalSettings = (await request(receipt.index + '/_settings')).body;
  if (finalSettings[receipt.index]?.settings?.index?.uuid !== uuid) throw Error('Index UUID changed during completion.');
  await verifyCurrentSources(snapshot);
  if (await readFile(config.receipt, 'utf8') !== originalText) throw Error('Original receipt changed during completion.');
  const output = { schemaVersion: 1, experiment: 'strict-hue-favorite-utilities-completion', completedAt: new Date().toISOString(), readOnly: true,
    originalReceipt: config.receipt, originalReceiptHash: hash(originalText), originalFailurePreserved: receipt.error,
    index: receipt.index, base: receipt.base, uuid, identityHash: receipt.identityHash, planHash: receipt.planHash, sourceSnapshotHash: receipt.sourceSnapshotHash,
    count: 545, sourceVerification: sources, mappingVerified: true,
    allowedMappingDefaults: ['_source.enabled:true', 'type:object when properties exist', 'float.doc_values:true', 'rank_features.positive_score_impact:true'],
    sampleAudit: { ordinals, ids: samples.map(doc => doc.id), valuesHash: hash(samples), verified: true },
    after: { mapping: mappingResponse.body, settings: settingsResponse.body, count: countResponse.body, stats: statsResponse.body, segments: segmentsResponse.body },
    completionSourceSnapshotHash: hash(await favoriteSourceSnapshot(import.meta.url)),
  };
  await writeFile(path.join(config.directory, 'completion.json'), JSON.stringify(output, null, 2));
  await writeFile(path.join(config.directory, 'source-snapshot.json'), JSON.stringify(await favoriteSourceSnapshot(import.meta.url)));
  return output;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await completeFavoriteUtilityIndex(favoriteUtilityCompletionConfiguration(process.argv.slice(2)));
  console.log(JSON.stringify({ completedAt: result.completedAt, index: result.index, uuid: result.uuid, count: result.count, mappingVerified: result.mappingVerified, samplesVerified: result.sampleAudit.verified }));
}
