import type { SearchSelection } from '../../catalogue/index.js';

export function searchBody(selection: SearchSelection) {
  const filter: unknown[] = [{ exists: { field: 'userId' } }];
  if (selection.profileId) filter.push({ term: { userId: selection.profileId } });
  const variantTerms = Object.entries(selection.variantFilters ?? {}).flatMap(([field, value]) =>
    value === undefined ? [] : [{ term: { [`variants.${field}`]: value } }]
  );
  if (variantTerms.length > 0)
    filter.push({ nested: { path: 'variants', query: { bool: { must: variantTerms } } } });
  return {
    query: {
      bool: {
        must: selection.colorVector
          ? [{ knn: { colorHistogram: { vector: selection.colorVector, k: 10_000 } } }]
          : [{ match_all: {} }],
        filter,
      },
    },
    search_after: selection.searchAfter,
    size: selection.size,
    track_total_hits: true,
    sort: selection.colorVector
      ? [
          { _score: selection.sortOrder },
          { wallpaperId: selection.sortOrder === 'desc' ? 'asc' : 'desc' },
        ]
      : [{ wallpaperId: selection.sortOrder }],
  };
}
