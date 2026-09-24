// THROWAWAY linked-control prototype. Retains the favorite utility formula;
// restricts its offered control pairs and requested percentages, never reranks.
import { createFavoriteUtilityPlan, favoriteUtilityParameters, supportsFavoriteUtilities } from './favorite-utilities.mjs';
import { buildFavoriteDocvalueFetchQuery } from './favorite-docvalue-fetch.mjs';

const steps = [[0, 0, 'Relaxed'], [.5, 0, 'Gentler'], [.5, 1, 'Favorite'], [1, 1, 'Stricter'], [1, 3, 'Strictest']]
  .map(([qualityInfluence, cutoffBlendExponent, label], i) => Object.freeze({ id: 'quality-' + i, label, qualityInfluence, cutoffBlendExponent }));
export const LINKED_STRICTNESS_BANKS = Object.freeze([3, 5].map(count => Object.freeze({
  id: 'linked-' + count, label: count + ' quality levels', index: `color-exploration-favorite-linked-${count}-real-v1`,
  steps: Object.freeze(count === 3 ? [steps[0], steps[2], steps[4]] : [...steps]), favoriteStep: Math.floor(count / 2),
  bucketCount: 256, percentageStep: 10, utilityCount: 279 * 12 * count,
})));
export function linkedStrictnessBank(id) {
  const bank = LINKED_STRICTNESS_BANKS.find(value => value.id === id);
  if (!bank) throw Error('Choose linked-3 or linked-5.');
  return bank;
}
export function linkedStrictnessSelection({ bankId, stepIndex } = {}) {
  const bank = linkedStrictnessBank(bankId);
  if (!Number.isInteger(stepIndex) || stepIndex < 0 || stepIndex >= bank.steps.length) throw Error('Choose an available linked quality level.');
  const { qualityInfluence, cutoffBlendExponent } = bank.steps[stepIndex];
  return favoriteUtilityParameters({ qualityInfluence, cutoffBlendExponent });
}
export function linkedStrictnessMetadata(bankId) {
  const bank = linkedStrictnessBank(bankId);
  return { bankId, percentageStep: bank.percentageStep, presets: bank.steps.map(({ qualityInfluence, cutoffBlendExponent }) => ({ qualityInfluence, cutoffBlendExponent })) };
}
const plans = new Map();
export function createLinkedStrictnessPlan(bankId) {
  if (plans.has(bankId)) return plans.get(bankId);
  const linkedStrictness = linkedStrictnessMetadata(bankId);
  const parent = createFavoriteUtilityPlan({ presets: linkedStrictness.presets });
  // Select parent descriptors rather than reimplementing zero-amount handling
  // or rounding. Each region and named target retains vibe plus 0..100 by10.
  const descriptors = parent.descriptors.filter(descriptor => {
    const amount = descriptor.key.match(/_(v|p\d{3})_q/)[1];
    return amount === 'v' || Number(amount.slice(1)) % 10 === 0;
  });
  const measurementFields = [...new Set(descriptors.flatMap(descriptor => descriptor.components.flatMap(component => [component.coverageField, component.qualityField])))].sort();
  const plan = { ...parent, descriptors, measurementFields, utilityCount: descriptors.length, linkedStrictness };
  if (plan.utilityCount !== linkedStrictnessBank(bankId).utilityCount) throw Error('Linked utility bank is incomplete.');
  plans.set(bankId, plan);
  return plan;
}
export function supportsLinkedStrictness(options = {}) {
  try {
    if (Object.hasOwn(options, 'parameters')) throw Error('Linked controls select a preset pair; independent scoring overrides are unsupported.');
    const parameters = linkedStrictnessSelection(options);
    const support = supportsFavoriteUtilities('favorite-utility-numeric', options.query, {
      parameters, eligibleIds: options.eligibleIds, excludedIds: options.excludedIds,
    });
    if (!support.supported) return support;
    if (support.compiled.mode === 'proportions' && support.compiled.targets.some(target => Math.abs(target.amount * 10 - Math.round(target.amount * 10)) > 1e-9)) {
      throw Error('Linked prototypes require target percentages in steps of10; amounts are not rounded.');
    }
    return { ...support, parameters, bankId: options.bankId, stepIndex: options.stepIndex,
      warnings: [...support.warnings, 'Linked controls restrict available pairs. Perceived strictness and result positions need not change uniformly. Named abstract features have no cutoff-weight effect.'] };
  } catch (error) { return { supported: false, reason: error.message }; }
}
export function buildLinkedStrictnessQuery(options = {}) {
  const support = supportsLinkedStrictness(options);
  if (!support.supported) throw Error(support.reason);
  const { query, limit, eligibleIds, excludedIds, filter } = options;
  return buildFavoriteDocvalueFetchQuery({ method: 'favorite-utility-numeric-docvalues', query, parameters: support.parameters,
    limit, eligibleIds, excludedIds, filter });
}
