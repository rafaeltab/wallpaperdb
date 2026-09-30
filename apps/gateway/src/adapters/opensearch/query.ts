import type { SearchSelection } from '../../capabilities/catalogue/index.js';
import { COLOR_UTILITY_VERSION } from '../../capabilities/catalogue/index.js';

export function searchBody(selection: SearchSelection) {
  const color = selection.color;
  const filter: unknown[] = [{ exists: { field: 'userId' } }];
  if (selection.profileId) filter.push({ term: { userId: selection.profileId } });
  const variantTerms = Object.entries(selection.variantFilters ?? {}).flatMap(([field, value]) =>
    value === undefined ? [] : [{ term: { [`variants.${field}`]: value } }]
  );
  if (variantTerms.length > 0)
    filter.push({ nested: { path: 'variants', query: { bool: { must: variantTerms } } } });
  if (color) filter.push({ term: { colorReady: COLOR_UTILITY_VERSION } });
  return {
    _source: [
      'wallpaperId',
      'userId',
      'variants',
      'uploadedAt',
      'updatedAt',
      ...(color ? ['colorReady'] : []),
    ],
    query: {
      bool: {
        must: color
          ? [{ constant_score: { filter: { match_all: {} }, boost: 0 } }]
          : [{ match_all: {} }],
        filter,
        ...(color
          ? {
              should: color.utilities.map(({ key, multiplicity }) => ({
                function_score: {
                  query: { match_all: {} },
                  field_value_factor: {
                    field: `utilities.${key}`,
                    factor: multiplicity / color.targetCount,
                    modifier: 'none',
                    missing: 0,
                  },
                  boost_mode: 'replace',
                },
              })),
              minimum_should_match: 0,
            }
          : {}),
      },
    },
    ...(color
      ? {
          docvalue_fields: ['wallpaperId', ...color.utilities.map(({ key }) => `utilities.${key}`)],
        }
      : {}),
    search_after: selection.searchAfter,
    size: selection.size,
    track_total_hits: true,
    sort: color
      ? [
          { _score: selection.sortOrder },
          { wallpaperId: selection.sortOrder === 'desc' ? 'asc' : 'desc' },
        ]
      : [{ wallpaperId: selection.sortOrder }],
  };
}
