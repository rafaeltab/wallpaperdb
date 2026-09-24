// Post-campaign accounting only. Normal flush/refresh; no query tuning or merges.
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FAVORITE_INDEX_PREFIX, FAVORITE_SNAPSHOT_ID, FAVORITE_SNAPSHOT_SHA256, favoriteProjectionFields, favoriteProjectionMapping } from './favorite-scale-corpus.mjs';
import { hueMapping } from './hue-index.mjs';
import { favoriteSourceSnapshot, settleFavoriteActivity } from './favorite-scale.mjs';
import { BASE, api, safeIndexName, hash } from './service.mjs';

const phases = Object.freeze([
  { phase: 'projection', scope: 'projection', bucketCount: null, count: 1000000 },
  { phase: 'full256', scope: 'full', bucketCount: 256, count: 100000 },
  { phase: 'full1024', scope: 'full', bucketCount: 1024, count: 100000 },
]);
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const same = (a, b) => hash(canonical(a)) === hash(canonical(b));
const atomicJson = async (file, value) => { await writeFile(file + '.tmp', JSON.stringify(value, null, 2)); await rename(file + '.tmp', file); };
const frozenMappingFor = ({ scope, bucketCount }) => scope === 'projection'
  ? favoriteProjectionMapping(favoriteProjectionFields()) : hueMapping({ bucketCount, source: true });

export function favoriteMaintenanceConfiguration(args = []) {
  const options = {};
  for (let cursor = 0; cursor < args.length; cursor++) {
    const flag = args[cursor];
    if (!['--campaign-root', '--directory', '--full1024-completion'].includes(flag)) throw Error('Unknown favorite maintenance option: ' + flag);
    const value = args[++cursor]; if (!value || value.startsWith('--')) throw Error('Missing favorite maintenance option: ' + flag);
    options[flag.slice(2)] = value;
  }
  if (!options['campaign-root'] || !options.directory) throw Error('Provide --campaign-root and --directory.');
  const campaignRoot = path.resolve(options['campaign-root']), directory = path.resolve(options.directory);
  if (directory === campaignRoot || phases.some(item => directory === path.join(campaignRoot, item.phase))) throw Error('Maintenance needs a new separate output directory.');
  const full1024Completion = options['full1024-completion'] ? path.resolve(options['full1024-completion']) : undefined;
  if (full1024Completion && path.dirname(full1024Completion) === directory) throw Error('Maintenance needs a new directory separate from completion evidence.');
  return { campaignRoot, directory, ...(full1024Completion ? { full1024Completion } : {}) };
}

function completedCampaignEvidence(artifact) {
  const finishedAt = Date.parse(artifact.finishedAt), invocations = artifact.invocations ?? [], last = invocations.at(-1);
  if (!Number.isFinite(finishedAt) || !last?.id || last.finishedAt !== artifact.finishedAt || !Number.isFinite(Date.parse(last.at)) || Date.parse(last.at) > finishedAt) throw Error('Maintenance requires the last invocation to be finished.');
  const finalSettle = artifact.settling?.at(-1), quietCount = finalSettle?.quietSamples;
  if (finalSettle?.phase !== 'after-campaign' || finalSettle.invocationId !== last.id || !finalSettle.settled || !Number.isSafeInteger(quietCount) || quietCount < 2 || !Array.isArray(finalSettle.samples) || finalSettle.samples.length < quietCount) throw Error('Maintenance requires a quiet final campaign settle.');
  const finalSamples = finalSettle.samples.slice(-quietCount);
  if (finalSamples.some(sample => !Number.isFinite(Date.parse(sample.at)) || Date.parse(sample.at) < Date.parse(last.at) || Date.parse(sample.at) > finishedAt
    || ['active', 'queued', 'queryCurrent', 'fetchCurrent', 'merges'].some(key => sample[key] !== 0))) throw Error('Maintenance final settle still shows activity or invalid timestamps.');
  if (artifact.interruption || (artifact.interruptions != null && !Array.isArray(artifact.interruptions))) throw Error('Maintenance refuses an unresolved interruption.');
  const interruptions = artifact.interruptions ?? [];
  for (const interruption of interruptions) {
    const interruptedAt = Date.parse(interruption.at), earlier = invocations.slice(0, -1).find(invocation => invocation.id === interruption.invocationId);
    const failedSettle = artifact.settling.find(group => group.invocationId === interruption.invocationId && group.settled === false
      && group.samples?.length && Number.isFinite(Date.parse(group.samples.at(-1).at)) && Date.parse(group.samples.at(-1).at) >= Date.parse(earlier?.at) && Date.parse(group.samples.at(-1).at) <= interruptedAt);
    if (!earlier || !Number.isFinite(Date.parse(earlier.at)) || !Number.isFinite(interruptedAt) || interruptedAt < Date.parse(earlier.at) || interruptedAt >= Date.parse(last.at)
      || String(interruption.error).split('\n')[0] !== 'Error: Search queue or merges did not settle; refusing to contaminate another block.' || !failedSettle) throw Error('Maintenance refuses an interruption without a completed later resume and matching settle evidence.');
  }
  return { invocations, interruptions, settling: artifact.settling, finalInvocationId: last.id };
}

function readOnlyCompletionEvidence(parent, completion, { parentArtifactHash, parentArtifactPath }) {
  if (parent.finishedAt || completion.experiment !== 'strict-hue-favorite-completion' || completion.readOnly !== true
    || completion.mappingNormalization !== 'opensearch-omitted-source-enabled-true-v1' || completion.interruption || completion.interruptions?.length) throw Error('Invalid separate read-only completion evidence.');
  if (completion.parentArtifactHash !== parentArtifactHash || !parentArtifactHash || path.resolve(completion.parentArtifact) !== path.resolve(parentArtifactPath)
    || completion.parentIdentityHash !== parent.identityHash || completion.index !== parent.index || completion.scope !== 'full' || completion.bucketCount !== 1024 || completion.count !== 100000
    || completion.primarySourceSnapshotHash !== parent.sourceSnapshotHash) throw Error('Completion parent lineage differs.');
  const history = { invocations: parent.invocations ?? [], interruptions: parent.interruptions ?? [], settling: parent.settling ?? [] };
  if (!same(completion.parentHistory, history)) throw Error('Completion discarded or changed parent history.');
  const startedAt = Date.parse(completion.startedAt), finishedAt = Date.parse(completion.finishedAt);
  if (!Number.isFinite(startedAt) || !Number.isFinite(finishedAt) || finishedAt < startedAt) throw Error('Separate completion is not finished.');
  const allowed = new Set(['Error: Search queue or merges did not settle; refusing to contaminate another block.', 'Error: Favorite scale mapping differs from frozen inputs.']);
  if (history.interruptions.some(item => !Number.isFinite(Date.parse(item.at)) || Date.parse(item.at) >= startedAt || !allowed.has(String(item.error).split('\n')[0]))
    || (parent.profiles ?? []).some(profile => profile.count === 100000) || (parent.warmups ?? []).some(group => group.count === 100000)) throw Error('Completion parent has unexpected interruption or existing100k measurement history.');
  const initial = completion.indexBefore, final = completion.indexAfter;
  if (!initial?.mappingHash || !initial.sampleValuesHash || initial.uuid !== parent.indexSettings?.uuid || final?.uuid !== initial.uuid || initial.count !== 100000 || final.count !== 100000
    || final.mappingHash !== initial.mappingHash || final.sampleValuesHash !== initial.sampleValuesHash || completion.finalIndexStats?.primaries?.docs?.count !== 100000) throw Error('Completion retained index identity differs.');
  const cases = parent.workload ?? [], profiles = completion.profiles ?? [], warmups = completion.warmups ?? [];
  if (cases.length !== 12 || profiles.length !== 12 || warmups.length !== 12 || new Set(profiles.map(profile => profile.caseId)).size !== 12) throw Error('Completion must cover all12 original cases.');
  for (const item of cases) {
    const profile = profiles.find(candidate => candidate.caseId === item.id);
    if (!profile || profile.count !== 100000 || profile.concurrency !== 1 || profile.method !== item.method || !same(profile.parameters, item.parameters)
      || !(profile.minimumRequests >= 32) || !(profile.requestedDurationMs >= 10000) || !(profile.elapsedMs >= profile.requestedDurationMs) || !Array.isArray(profile.trials) || profile.trials.length < 32
      || profile.trials.some((row, ordinal) => row.ordinal !== ordinal || !Number.isFinite(row.elapsedMs) || row.elapsedMs < 0)
      || !warmups.some(group => group.caseId === item.id && group.count === 100000 && group.trials?.length)) throw Error('Completion case protocol differs: ' + item.id);
  }
  const finalSettle = completion.settling?.at(-1), quietCount = finalSettle?.quietSamples;
  if (!finalSettle?.settled || finalSettle.phase !== 'after-campaign' || !Number.isSafeInteger(quietCount) || quietCount < 2 || !Array.isArray(finalSettle.samples) || finalSettle.samples.length < quietCount
    || finalSettle.samples.slice(-quietCount).some(sample => !Number.isFinite(Date.parse(sample.at)) || Date.parse(sample.at) < startedAt || Date.parse(sample.at) > finishedAt
      || ['active', 'queued', 'queryCurrent', 'fetchCurrent', 'merges'].some(key => sample[key] !== 0))) throw Error('Separate completion needs a quiet final settle.');
  return { kind: 'separate-read-only-completion', parentHistory: history, completionStartedAt: completion.startedAt, completionFinishedAt: completion.finishedAt,
    completedCaseIds: profiles.map(profile => profile.caseId), completionSettling: completion.settling };
}

export function validateFavoriteMaintenanceCampaign(artifact, phase, completionOptions) {
  const expected = phases.find(item => item.phase === phase);
  if (!expected) throw Error('Unknown favorite maintenance phase.');
  if (completionOptions && phase !== 'full1024') throw Error('Separate completion is only supported for full1024.');
  const completion = completionOptions?.completion;
  const finishedAt = completion?.finishedAt ?? artifact.finishedAt;
  if (!finishedAt || !Number.isFinite(Date.parse(finishedAt))) throw Error('Maintenance requires finished scale artifacts.');
  const completionEvidence = completion ? readOnlyCompletionEvidence(artifact, completion, completionOptions) : completedCampaignEvidence(artifact);
  if (artifact.experiment !== 'strict-hue-favorite-scale' || artifact.snapshotId !== FAVORITE_SNAPSHOT_ID || !artifact.index?.startsWith(FAVORITE_INDEX_PREFIX)
    || artifact.identity?.experiment !== artifact.experiment || hash(artifact.identity) !== artifact.identityHash || artifact.identity.source?.snapshotManifestHash !== FAVORITE_SNAPSHOT_SHA256) throw Error('Favorite campaign identity differs.');
  safeIndexName(artifact.index);
  if (artifact.scope !== expected.scope || artifact.configuration?.scope !== expected.scope || (artifact.configuration.bucketCount ?? null) !== expected.bucketCount
    || artifact.identity.scope !== expected.scope || artifact.identity.bucketCount !== expected.bucketCount) throw Error('Favorite campaign scope or bank differs.');
  if ((completion?.finalIndexStats ?? artifact.finalIndexStats)?.primaries?.docs?.count !== expected.count) throw Error('Favorite campaign final count differs.');
  if (!artifact.indexSettings?.uuid) throw Error('Favorite campaign has no index UUID.');
  const expectedMappingHash = hash(frozenMappingFor(expected));
  if (artifact.identity.mappingHash !== expectedMappingHash) throw Error('Favorite campaign mapping differs from the frozen schema.');
  return { ...expected, index: artifact.index, uuid: artifact.indexSettings.uuid, identity: artifact.identity, identityHash: artifact.identityHash, expectedMappingHash, finishedAt, completionEvidence };
}

function values(campaign, state) {
  return { mapping: state.mapping?.body?.[campaign.index]?.mappings,
    settings: state.settings?.body?.[campaign.index]?.settings?.index, count: state.count?.body?.count };
}
// OpenSearch may omit the default enabled source declaration when serializing
// mappings. Normalize only that default; disabled source and all fields stay exact.
export function normalizeFavoriteMaintenanceMapping(mapping) {
  if (mapping?._source === undefined) return { ...mapping, _source: { enabled: true } };
  if (mapping._source && typeof mapping._source === 'object' && mapping._source.enabled === undefined) return { ...mapping, _source: { ...mapping._source, enabled: true } };
  return mapping;
}
export function validateFavoriteMaintenanceState(campaign, state) {
  const { mapping, settings, count } = values(campaign, state);
  if (count !== campaign.count) throw Error('Favorite retained count differs: ' + campaign.phase);
  if (settings?.uuid !== campaign.uuid) throw Error('Favorite retained UUID differs: ' + campaign.phase);
  if (Number(settings.number_of_shards) !== 1 || Number(settings.number_of_replicas) !== 0) throw Error('Favorite retained topology differs: ' + campaign.phase);
  if (mapping?._meta?.experiment !== 'strict-hue-favorite-scale' || mapping._meta.identityHash !== campaign.identityHash || !same(mapping._meta.identity, campaign.identity)) throw Error('Favorite retained metadata identity differs: ' + campaign.phase);
  const { _meta, ...actualMapping } = mapping;
  if (!same(normalizeFavoriteMaintenanceMapping(actualMapping), normalizeFavoriteMaintenanceMapping(frozenMappingFor(campaign).mappings))) throw Error('Favorite retained mapping differs from the frozen schema: ' + campaign.phase);
  return true;
}
export function assertFavoriteMaintenanceStable(campaign, before, after) {
  validateFavoriteMaintenanceState(campaign, before); validateFavoriteMaintenanceState(campaign, after);
  const initial = values(campaign, before), final = values(campaign, after);
  if (!same(normalizeFavoriteMaintenanceMapping(initial.mapping), normalizeFavoriteMaintenanceMapping(final.mapping))) throw Error('Favorite mapping changed during maintenance: ' + campaign.phase);
  if (!same(initial.settings, final.settings)) throw Error('Favorite settings changed during maintenance: ' + campaign.phase);
  return true;
}
export function favoriteMaintenanceOperations(index) {
  safeIndexName(index);
  if (!index.startsWith(FAVORITE_INDEX_PREFIX)) throw Error('Maintenance accepts favorite indexes only.');
  return [{ kind: 'flush', route: index + '/_flush?wait_if_ongoing=true', method: 'POST' },
    { kind: 'refresh', route: index + '/_refresh', method: 'POST' }];
}

async function observed(route, options) {
  const startedAt = new Date().toISOString(), response = await api(route, options);
  return { route, method: options?.method ?? 'GET', startedAt, finishedAt: new Date().toISOString(), ...response };
}
async function capture(campaign) {
  const state = { capturedAt: new Date().toISOString() };
  for (const [name, route] of Object.entries({ mapping: '/_mapping', settings: '/_settings', count: '/_count', stats: '/_stats/store,docs,segments,merge,indexing', segments: '/_segments' })) {
    state[name] = await observed(campaign.index + route);
  }
  validateFavoriteMaintenanceState(campaign, state);
  return state;
}

export async function runFavoriteMaintenance(config) {
  if (new URL(BASE).port !== '19217') throw Error('Favorite maintenance requires isolated OpenSearch port19217.');
  const campaigns = [], primarySource = await favoriteSourceSnapshot();
  let separateCompletion;
  if (config.full1024Completion) {
    const bytes = await readFile(config.full1024Completion), completion = JSON.parse(bytes);
    const sourceFile = completion.sourceFile ?? path.join(path.dirname(config.full1024Completion), 'source-snapshot.json');
    const archivedSource = JSON.parse(await readFile(sourceFile)), currentSource = await favoriteSourceSnapshot(new URL('./favorite-completion.mjs', import.meta.url));
    if (hash(archivedSource) !== completion.sourceSnapshotHash || hash(currentSource) !== completion.sourceSnapshotHash) throw Error('Separate completion source fingerprint differs.');
    separateCompletion = { completion, record: { path: config.full1024Completion, sha256: hash(bytes), sourceSnapshotHash: completion.sourceSnapshotHash } };
  }
  // Verify every completed campaign and source graph before touching any index.
  for (const expected of phases) {
    const campaignFile = path.join(config.campaignRoot, expected.phase, 'scale.json');
    const bytes = await readFile(campaignFile), artifact = JSON.parse(bytes);
    const completionOptions = expected.phase === 'full1024' && separateCompletion
      ? { completion: separateCompletion.completion, parentArtifactHash: hash(bytes), parentArtifactPath: campaignFile } : undefined;
    const campaign = validateFavoriteMaintenanceCampaign(artifact, expected.phase, completionOptions);
    const archivedSource = JSON.parse(await readFile(artifact.sourceFile));
    if (hash(archivedSource) !== artifact.sourceSnapshotHash || hash(primarySource) !== artifact.sourceSnapshotHash
      || !same(Object.fromEntries(Object.entries(archivedSource).map(([name, source]) => [name, hash(source)])), artifact.identity.sourceHashes)) throw Error('Favorite campaign source fingerprint differs: ' + expected.phase);
    campaigns.push({ ...campaign, campaignFile, campaignSha256: hash(bytes), sourceSnapshotHash: artifact.sourceSnapshotHash,
      ...(completionOptions ? { completionRecord: separateCompletion.record } : {}) });
  }
  if (new Set(campaigns.map(campaign => campaign.index)).size !== 3) throw Error('Maintenance requires three distinct favorite indexes.');
  const sourceSnapshot = await favoriteSourceSnapshot(import.meta.url);
  const plan = { experiment: 'strict-hue-favorite-maintenance', schemaVersion: 1, campaignRoot: config.campaignRoot, base: BASE,
    campaigns, sourceSnapshotHash: hash(sourceSnapshot), operations: 'Normal per-index flush(wait_if_ongoing=true), refresh, and passive settling; no force merge, settings changes or document writes.' };
  await mkdir(path.dirname(config.directory), { recursive: true }); await mkdir(config.directory);
  await writeFile(path.join(config.directory, 'plan.json'), JSON.stringify(plan, null, 2), { flag: 'wx' });
  await writeFile(path.join(config.directory, 'source-snapshot.json'), JSON.stringify(sourceSnapshot, null, 2), { flag: 'wx' });
  const result = { ...plan, directory: config.directory, startedAt: new Date().toISOString(), planHash: hash(plan), preconditionsVerified: false, indices: [] };
  const save = () => atomicJson(path.join(config.directory, 'maintenance.json'), result);
  await save(); console.log('FAVORITE_MAINTENANCE_ARTIFACT ' + path.join(config.directory, 'maintenance.json'));
  try {
    // All three live-index preconditions must pass before the first mutation.
    for (const campaign of campaigns) { result.indices.push({ ...campaign, preflight: await capture(campaign), status: 'preflight-verified' }); await save(); }
    result.preconditionsVerified = true; result.preconditionsVerifiedAt = new Date().toISOString(); await save();
    for (const entry of result.indices) {
      entry.before = await capture(entry); assertFavoriteMaintenanceStable(entry, entry.preflight, entry.before);
      entry.status = 'before-verified'; await save();
      for (const operation of favoriteMaintenanceOperations(entry.index)) {
        entry[operation.kind] = await observed(operation.route, { method: operation.method }); await save();
        if (entry[operation.kind].body?._shards?.failed) throw Error('Favorite maintenance shard failure: ' + operation.kind);
      }
      entry.status = 'flushed-and-refreshed'; await save();
      entry.settling = await settleFavoriteActivity(); await save();
      if (!entry.settling.settled) throw Error('Favorite post-maintenance activity did not settle: ' + entry.phase);
      entry.after = await capture(entry); assertFavoriteMaintenanceStable(entry, entry.before, entry.after);
      entry.mappingHash = hash(canonical(values(entry, entry.after).mapping));
      entry.status = 'complete'; entry.completedAt = new Date().toISOString(); await save();
    }
    if (hash(await favoriteSourceSnapshot(import.meta.url)) !== hash(sourceSnapshot)) throw Error('Maintenance source changed during execution.');
    result.finishedAt = new Date().toISOString(); await save(); return { directory: config.directory, result };
  } catch (error) { result.interruption = { at: new Date().toISOString(), error: error.stack ?? String(error) }; await save(); throw error; }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await runFavoriteMaintenance(favoriteMaintenanceConfiguration(process.argv.slice(2)));
