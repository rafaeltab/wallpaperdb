// THROWAWAY all-preset load definition. Generates requests and evidence only;
// OpenSearch remains responsible for every returned global ranking.
import { FAVORITE_UTILITY_PRESETS } from './favorite-utilities.mjs';

const presets = FAVORITE_UTILITY_PRESETS.qualityInfluence.flatMap(qualityInfluence =>
  FAVORITE_UTILITY_PRESETS.cutoffBlendExponent.map(cutoffBlendExponent => Object.freeze({
    id: `q${String(qualityInfluence * 100).padStart(3, '0')}_w${cutoffBlendExponent}`,
    parameters: Object.freeze({ qualityInfluence, cutoffBlendExponent }),
  })));
export const FAVORITE_PRESET_WORKLOAD = Object.freeze({
  version: 1, presets: Object.freeze(presets), utilityKeysPerPreset: 6138,
  ordering: 'Retain base query order; execute every base query at all9presets in q0/.5/1 then weight0/1/3 order.',
  comparisons: 'Run the unchanged favorite workload against both indexes separately. Mixed presets are a different field-access workload, not a favorite-only speed comparison.',
  wideQueries: 73656, utilityKeys: 55242,
  warmup: 'For wide:64 evenly spaced base queries, each at all9presets. Fixed/varied warm every distinct query.',
  coverage: 'Record actual scheduled, dispatched, successful and within-budget requests per preset; rejected and failed requests cannot establish successful field coverage.',
});

export function favoritePresetId(parameters) {
  const preset = presets.find(item => item.parameters.qualityInfluence === parameters?.qualityInfluence
    && item.parameters.cutoffBlendExponent === parameters?.cutoffBlendExponent);
  if (!preset) throw Error('Unknown scoring preset.');
  return preset.id;
}

export function withFavoritePresets(baseQueries) {
  if (!Array.isArray(baseQueries) || !baseQueries.length || baseQueries.some(item => !item?.id || !item.query)
    || new Set(baseQueries.map(item => item.id)).size !== baseQueries.length) throw Error('Preset workload needs unique nonempty base queries.');
  return baseQueries.flatMap(item => presets.map(preset => ({ ...item, id: preset.id + '--' + item.id,
    baseQueryId: item.id, presetId: preset.id, parameters: { ...item.parameters, ...preset.parameters } })));
}

export function favoritePresetWarmupOrdinals(baseCount) {
  if (!Number.isSafeInteger(baseCount) || baseCount < 1) throw Error('Invalid preset base query count.');
  const selected = Math.min(64, baseCount);
  return Array.from({ length: selected }, (_, i) => selected === 1 ? 0 : Math.floor(i * (baseCount - 1) / (selected - 1)))
    .flatMap(baseOrdinal => presets.map((_, presetOrdinal) => baseOrdinal * presets.length + presetOrdinal));
}

const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

export function summarizeFavoritePresetCoverage({ trials, queryPlans }) {
  const byId = new Map(queryPlans.map(plan => [plan.queryId, plan]));
  if (byId.size !== queryPlans.length) throw Error('Duplicate query identity in preset coverage.');
  const groups = new Map(presets.map(preset => [preset.id, { presetId: preset.id, parameters: preset.parameters,
    scheduledRequests: 0, dispatchedRequests: 0, successfulRequests: 0, withinBudgetRequests: 0,
    errors: 0, atOrAboveOneSecond: 0, strictFailures: 0, ids: new Set(), keys: new Set() }]));
  for (const row of trials) {
    const plan = byId.get(row.queryId);
    if (!plan || row.queryOrdinal !== plan.queryOrdinal || !same(row.parameters, plan.parameters)) throw Error('Preset request identity differs from preflight.');
    const id = favoritePresetId(plan.parameters), group = groups.get(id);
    if (plan.utilityKeys.some(key => !key.endsWith('_' + id))) throw Error('Preset scoring fields differ from requested preset.');
    const successful = !row.clientRejected && !row.error && Number.isFinite(row.elapsedMs) && row.elapsedMs >= 0;
    const failed = !successful || row.elapsedMs >= 1000;
    group.scheduledRequests++;
    if (!row.clientRejected) group.dispatchedRequests++;
    if (row.error) group.errors++;
    if (row.elapsedMs >= 1000) group.atOrAboveOneSecond++;
    if (failed) group.strictFailures++;
    if (!failed) group.withinBudgetRequests++;
    if (successful) {
      group.successfulRequests++; group.ids.add(row.queryId);
      for (const key of plan.utilityKeys) group.keys.add(key);
    }
  }
  return [...groups.values()].map(({ ids, keys, ...group }) => ({ ...group,
    successfulQueryCount: ids.size, successfulUtilityKeyCount: keys.size,
    expectedUtilityKeyCount: FAVORITE_PRESET_WORKLOAD.utilityKeysPerPreset,
    fullUtilityBankCovered: keys.size === FAVORITE_PRESET_WORKLOAD.utilityKeysPerPreset }));
}
