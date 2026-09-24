// THROWAWAY visual comparison. The service ranks every eligible wallpaper.
import { extname } from 'node:path';
import { api } from './service.mjs';
import { interpretQuery } from './query.mjs';
import { favoriteUtilityParameters } from './favorite-utilities.mjs';
import { searchFavoriteDocvalueUtilities } from './favorite-docvalue-fetch.mjs';
import { LINKED_STRICTNESS_BANKS, linkedStrictnessSelection, createLinkedStrictnessPlan, supportsLinkedStrictness } from './linked-strictness.mjs';

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const realAsset = asset => asset.cohort !== 'controlled-fixture' && extname(asset.filename ?? '').toLowerCase() !== '.svg';
const bankFor = steps => LINKED_STRICTNESS_BANKS.find(bank => bank.id === `linked-${steps}`);
const expectedKeys = new Map();

export function validateLinkedStrictnessRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw fail('Expected a search request.');
  for (const key of Object.keys(body)) if (!['variant', 'steps', 'level', 'query', 'parameters', 'limit'].includes(key)) throw fail('Unsupported request field: ' + key);
  if (!['original', 'linked'].includes(body.variant)) throw fail('Choose original or linked controls.');
  let parameters, bank;
  if (body.variant === 'linked') {
    bank = bankFor(body.steps);
    if (!bank || !Number.isInteger(body.level) || body.level < 0 || body.level >= bank.steps.length) throw fail('Choose a valid strictness level in the three- or five-step slider.');
    if (body.parameters !== undefined) throw fail('Linked controls use the selected preset; independent parameter overrides are unavailable.');
    parameters = linkedStrictnessSelection({ bankId: bank.id, stepIndex: body.level });
  } else {
    try { parameters = favoriteUtilityParameters(body.parameters); }
    catch (error) { throw fail(error.message); }
  }
  const query = body.query;
  if (!query || !['vibe', 'proportions'].includes(query.mode) || !Array.isArray(query.targets) || query.targets.length < 1 || query.targets.length > 8) throw fail('Choose a mode and between one and eight targets.');
  const interpreted = interpretQuery(query);
  if (!interpreted.supported) throw fail(interpreted.reason);
  const step = body.variant === 'linked' ? 10 : 5;
  if (query.mode === 'proportions' && interpreted.targets.some(target => Math.abs(target.amount * 100 / step - Math.round(target.amount * 100 / step)) > 1e-9)) {
    throw fail(`Use target percentages in steps of ${step}; values are never silently rounded.`);
  }
  const limit = body.limit ?? 48;
  if (!Number.isInteger(limit) || limit < 1 || limit > 523) throw fail('Result count must be between 1 and 523.');
  return { variant: body.variant, query, parameters, limit, ...(bank ? { bankId: bank.id, steps: body.steps, level: body.level } : {}) };
}

export async function createLinkedStrictnessLabProvider({ corpus, originalSearch, readIndexState,
  request = api, searchService = searchFavoriteDocvalueUtilities } = {}) {
  if (!Array.isArray(corpus) || typeof originalSearch !== 'function' || typeof readIndexState !== 'function') throw Error('Strictness comparison needs corpus, original search and index-state reader.');
  const ids = corpus.map(asset => asset.id), real = corpus.filter(realAsset), excludedIds = corpus.filter(asset => !realAsset(asset)).map(asset => asset.id);
  if (new Set(ids).size !== ids.length) throw Error('Corpus IDs must be unique.');
  const checked = new Map();
  async function checkBank(bank, signal) {
    let state;
    try { state = await readIndexState(bank.index, { signal, numericPoints: true, idDocValues: true }); }
    catch (error) { throw fail('Compact index unavailable: ' + error.message, 503); }
    const meta = state.metadata, linked = meta?.linkedStrictness;
    if (!state.uuid || meta?.experiment !== 'strict-hue-favorite-utilities' || meta.utilityDefinitionVersion !== 2
      || meta.mode !== 'real' || meta.scope !== 'full' || meta.count !== ids.length || meta.presets !== 'linked'
      || meta.numericPoints !== true || !meta.encodings?.includes('numeric') || !meta.identityHash || !meta.planHash
      || linked?.bankId !== bank.id || linked.percentageStep !== 10) throw fail('Compact index metadata does not match this complete prototype.', 503);
    const generation = JSON.stringify([bank.index, state.uuid, state.generationToken, meta.identityHash, meta.planHash]);
    if (!checked.has(generation)) {
      const pending = (async () => {
        if (state.sourceEnabled !== false || state.idField?.type !== 'keyword' || state.idField.doc_values === false) throw fail('Compact index needs source disabled and keyword ID doc values.', 503);
        if (!expectedKeys.has(bank.id)) expectedKeys.set(bank.id, new Set(createLinkedStrictnessPlan(bank.id).descriptors.map(descriptor => descriptor.key)));
        const expected = expectedKeys.get(bank.id), fields = Object.entries(state.numericUtilityFields ?? {});
        if (fields.length !== expected.size || fields.some(([key, field]) => !expected.has(key) || field.type !== 'float' || field.index === false || field.doc_values === false)) throw fail('Compact index has missing or unexpected score fields.', 503);
        const result = await request(`${bank.index}/_mget?_source=false&filter_path=docs._id,docs.found,docs.error`, { method: 'POST', body: { ids }, signal, timeoutMs: 10000 });
        const found = new Set((result.body.docs ?? []).filter(doc => doc.found && !doc.error).map(doc => doc._id));
        if (state.documentCount !== ids.length || found.size !== ids.length || ids.some(id => !found.has(id))) throw fail('Compact index must contain every corpus image before comparison.', 503);
        return { index: bank.index, indexUuid: state.uuid, indexIdentityHash: meta.identityHash,
          indexedCorpusCount: ids.length, utilityFields: expected.size, engine: 'OpenSearch' };
      })();
      checked.set(generation, pending);
    }
    try { return await checked.get(generation); }
    catch (error) { checked.delete(generation); throw error; }
  }
  return {
    async getStrictness() {
      const banks = await Promise.all(LINKED_STRICTNESS_BANKS.map(async bank => {
        try { const evidence = await checkBank(bank); return { ...bank, available: true, evidence }; }
        catch (error) { return { ...bank, available: false, unavailableReason: error.message }; }
      }));
      return { wallpaperCount: real.length, banks, levels: Object.fromEntries(banks.map(bank => [bank.steps.length, bank.steps])),
        variants: { original: { available: true, percentageStep: 5 }, linked: { available: banks.some(bank => bank.available), percentageStep: 10 } } };
    },
    async searchStrictness({ variant, bankId, steps, level, query, parameters, limit, signal }) {
      if (variant === 'original') {
        const result = await originalSearch({ methodId: 'cutoff-shade-hue-all-levels', query, parameters, limit, signal });
        return { ...result, variant, parameters };
      }
      const bank = bankFor(steps);
      if (!bank || bank.id !== bankId) throw fail('Unknown linked bank.');
      const support = supportsLinkedStrictness({ bankId, stepIndex: level, query, excludedIds });
      if (!support.supported) return { supported: false, reason: support.reason, warnings: support.warnings ?? [], hits: [], variant, parameters };
      const evidence = await checkBank(bank, signal);
      const result = await searchService({ index: bank.index, method: 'favorite-utility-numeric-docvalues', query, parameters, limit,
        excludedIds, signal, timeoutMs: 10000 });
      return { ...result, supported: true, variant, steps, level, parameters,
        evidence: { ...result.evidence, ...evidence, bankId }, warnings: support.warnings,
        precision: 'Same favorite formula at linked presets, precomputed as floats; close ties can differ from the original rounding order.' };
    },
  };
}
