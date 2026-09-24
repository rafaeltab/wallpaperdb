// Separate variants: unchanged global scoring/PIT algorithm, pooled DELETE only.
import { BASE } from './service.mjs';
import { FAVORITE_BOUNDED_METHODS, buildFavoriteBoundedQuery, supportsFavoriteBounded, executeFavoriteBoundedUtilitySearch } from './favorite-bounded-utilities.mjs';
import { FAVORITE_MAXIMA_BOUNDED_METHODS, executeFavoriteMaximaBoundedUtilitySearch } from './favorite-maxima-bounded-utilities.mjs';
import { createFavoritePooledDeleteTransport, FAVORITE_POOLED_DELETE_DEFINITION } from './favorite-pooled-delete.mjs';

export const FAVORITE_POOLED_DEFINITION = Object.freeze({ version: 1, transport: FAVORITE_POOLED_DELETE_DEFINITION,
  score: 'Unchanged parent numeric objective, seed searches, global bounds, PIT consistency and cleanup acknowledgement',
  duplicates: 'Preserve the parent duplicate-target behavior; this is not the multiplicity correction',
  poolLifetime: 'One shared pool per service origin across queries; close only after callers drain query execution',
});
export const FAVORITE_POOLED_METHODS = Object.freeze([FAVORITE_BOUNDED_METHODS[0], FAVORITE_MAXIMA_BOUNDED_METHODS[0]].map(parent => Object.freeze({
  ...parent, id: parent.id + '-pooled-delete', parentMethod: parent.id, family: 'favorite-pooled-utilities', searchKind: 'favorite-pooled-utilities',
  label: parent.label + ' · pooled PIT cleanup',
  description: parent.description + ' Reuse native HTTP connections for snapshot cleanup.',
  limitations: Object.freeze([...parent.limitations, 'Only PIT cleanup transport changes. The shared pool must survive individual queries; no retries are added.']),
})));
const pools = new Map();
export function getFavoritePooledTransport(base = BASE) {
  if (!pools.has(base)) pools.set(base, createFavoritePooledDeleteTransport({ base }));
  return pools.get(base);
}
export async function closeFavoritePooledTransports() { const open = [...pools.values()]; pools.clear(); await Promise.all(open.map(pool => pool.close())); }
function definition(input = FAVORITE_POOLED_METHODS[0].id) {
  const id = typeof input === 'string' ? input : input?.id, method = FAVORITE_POOLED_METHODS.find(item => item.id === id);
  if (!method) throw Error('Unknown pooled utility method: ' + id); return method;
}
export function supportsFavoritePooled(method, query, options = {}) { definition(method); return supportsFavoriteBounded('favorite-utility-bounded', query, options); }
export function buildFavoritePooledQuery({ method, ...options }) { definition(method); return buildFavoriteBoundedQuery(options); }

export async function executeFavoritePooledUtilitySearch({ method: input, request: injected, base = BASE, ...options }) {
  const method = definition(input), backend = injected ?? getFavoritePooledTransport(base).request;
  const transport = { kind: FAVORITE_POOLED_DELETE_DEFINITION.kind, version: 1, nativeDeleteRequests: 0, nativeDeleteResponses: 0, reusedConnections: 0, attempts: 0 };
  const request = async (route, settings) => {
    const cleanup = route === '_search/point_in_time' && settings.method === 'DELETE';
    if (cleanup) transport.nativeDeleteRequests++;
    try {
      const response = await backend(route, settings);
      if (cleanup) {
        const witness = response.transport;
        if (witness?.kind !== transport.kind || witness.version !== 1 || witness.attempts !== 1 || typeof witness.reusedSocket !== 'boolean') throw Error('Missing actual pooled DELETE witness; raw API injection cannot validate this variant.');
        transport.nativeDeleteResponses++; transport.attempts += witness.attempts;
        if (witness.reusedSocket) transport.reusedConnections++;
      }
      return response;
    } catch (error) { if (cleanup && error.transport?.kind === transport.kind) transport.attempts += error.transport.attempts; throw error; }
  };
  const execute = method.parentMethod === 'favorite-utility-bounded' ? executeFavoriteBoundedUtilitySearch : executeFavoriteMaximaBoundedUtilitySearch;
  try {
    const result = await execute({ ...options, request });
    if (!transport.nativeDeleteResponses) throw Error('No actual pooled DELETE witness in successful execution.');
    return { ...result, evidence: { ...result.evidence, method: method.id, parentMethod: method.parentMethod, transport: { ...transport } } };
  } catch (error) { error.evidence = { ...error.evidence, method: method.id, parentMethod: method.parentMethod, transport: { ...transport } }; throw error; }
}
