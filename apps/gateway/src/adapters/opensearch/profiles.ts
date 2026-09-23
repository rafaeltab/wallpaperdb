import type { ProfileSearchSelection } from '../../catalogue/index.js';

function activeAliasFilter(now: string) {
  return {
    bool: {
      should: [
        { bool: { must_not: { exists: { field: 'aliases.expiresAt' } } } },
        { range: { 'aliases.expiresAt': { gt: now } } },
      ],
      minimum_should_match: 1,
    },
  };
}

export function aliasClaimSearch(handle: string, now: string) {
  const filter = {
    bool: { filter: [{ term: { 'aliases.handle': handle } }, activeAliasFilter(now)] },
  };
  return {
    query: { nested: { path: 'aliases', query: filter } },
    sort: [
      {
        'aliases.claimGeneration': {
          order: 'desc',
          mode: 'max',
          nested: { path: 'aliases', filter },
        },
      },
    ],
    size: 1,
  };
}

export function profileSearchBody(selection: ProfileSearchSelection, now: string) {
  const aliasMatch = (query: Record<string, unknown>) => ({
    nested: {
      path: 'aliases',
      score_mode: 'none',
      query: { bool: { filter: [query, activeAliasFilter(now)] } },
    },
  });
  const tiers = [
    { term: { handle: selection.query } },
    { prefix: { handle: selection.query } },
    aliasMatch({ term: { 'aliases.handle': selection.query } }),
    aliasMatch({ prefix: { 'aliases.handle': selection.query } }),
    { match_phrase_prefix: { displayName: selection.query } },
    { match: { displayName: { query: selection.query, fuzziness: 'AUTO', operator: 'and' } } },
  ];
  return {
    query: {
      dis_max: {
        tie_breaker: 0,
        queries: tiers.map((filter, index) => ({
          constant_score: { filter, boost: tiers.length - index },
        })),
      },
    },
    sort: [{ _score: 'desc' }, { id: 'asc' }],
    size: selection.size,
    search_after: selection.searchAfter,
  };
}
