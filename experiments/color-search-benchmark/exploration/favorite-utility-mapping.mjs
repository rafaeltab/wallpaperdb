// OpenSearch 2.11 omits these four explicit defaults when serializing mappings.
// Normalize only mapping nodes, never metadata or arbitrary nested objects.
import { hash } from './service.mjs';

export const canonicalUtilityValue = value => Array.isArray(value) ? value.map(canonicalUtilityValue)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalUtilityValue(value[key])])) : value;

export const sameUtilityValue = (left, right) => hash(canonicalUtilityValue(left)) === hash(canonicalUtilityValue(right));

export function normalizeFavoriteUtilityMapping(mapping) {
  if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) throw Error('Utility mapping must be an object.');
  const output = structuredClone(mapping);
  if (!Object.hasOwn(output, '_source')) output._source = { enabled: true };
  const visit = field => {
    if (field.properties && !Object.hasOwn(field, 'type')) field.type = 'object';
    if (field.type === 'float' && !Object.hasOwn(field, 'doc_values')) field.doc_values = true;
    if (field.type === 'rank_features' && !Object.hasOwn(field, 'positive_score_impact')) field.positive_score_impact = true;
    for (const child of Object.values(field.properties ?? {})) visit(child);
    for (const child of Object.values(field.fields ?? {})) visit(child);
  };
  for (const field of Object.values(output.properties ?? {})) visit(field);
  return output;
}

export function assertFavoriteUtilityMapping(actual, expected) {
  if (!sameUtilityValue(normalizeFavoriteUtilityMapping(actual), normalizeFavoriteUtilityMapping(expected))) {
    throw Error('Utility mapping differs beyond the four explicitly allowed OpenSearch serialization defaults.');
  }
}
