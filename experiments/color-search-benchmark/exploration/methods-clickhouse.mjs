// SQL compilation only: ClickHouse performs every filter, score, sort and limit.
import { supportsPrecisionTyped, buildPrecisionTypedQuery } from './methods-precision-typed.mjs';
import { clickHouseRequest, safeClickHouseTable, arrayParameter, CLICKHOUSE_REAL_TABLE } from './clickhouse-service.mjs';
export const CLICKHOUSE_METHOD = Object.freeze({ id: 'clickhouse-palette-precision', label: 'ClickHouse exact picked-color palette precision', engine: 'clickhouse', family: 'columnar-palette', representation: 'palette32-original-oklab', searchKind: 'clickhouse', approximate: false,
  limitations: ['Supports one picked-hex vibe target and an OKLab radius only.', 'Exact global SQL ranking over the stored 32-color palette; the palette remains an image approximation.', 'Scans eligible palette arrays; scalability must be measured separately from OpenSearch.', 'Subject eligibility requires caller-supplied eligible IDs; unsupported metadata filters are rejected.'] });
export function supportsClickHouse(query, options = {}) {
  const check = supportsPrecisionTyped(query);
  if (!check.supported) return { ...check, reason: `ClickHouse precision supports one picked hex in vibe mode with an OKLab radius only. ${check.reason?.startsWith('Exact palette-cell') ? '' : check.reason ?? ''}`.trim() };
  if (check.compiled.subject && !options.eligibleIds) return { supported: false, reason: 'ClickHouse subject eligibility requires explicit eligible IDs.' };
  return { ...check, warnings: CLICKHOUSE_METHOD.limitations };
}
function filtersToSQL({ eligibleIds, excludedIds, filter, params }) {
  let ordinal = 0;
  const valueParam = (value, type) => { const key = `filter_${ordinal++}`; params[key] = type.startsWith('Array') ? arrayParameter(value) : value; return `{${key}:${type}}`; };
  const columns = { id: 'String', reference_id: 'String', cohort: 'String', partition: 'UInt8' };
  const walk = input => {
    if (Array.isArray(input)) return input.length ? '(' + input.map(walk).join(' AND ') + ')' : '1';
    if (!input || typeof input !== 'object' || Object.keys(input).length !== 1) throw new Error('Unsupported ClickHouse metadata filter');
    if (input.match_all) return '1';
    if (input.match_none) return '0';
    if (input.ids) return `id IN ${valueParam(input.ids.values, 'Array(String)')}`;
    if (input.term || input.terms) {
      const entries = Object.entries(input.term ?? input.terms);
      if (entries.length !== 1 || !columns[entries[0][0]]) throw new Error('Unsupported ClickHouse metadata field');
      const [field, value] = entries[0], type = columns[field];
      if (input.terms) {
        if (type !== 'String') throw new Error('Only string terms arrays are supported');
        return `${field} IN ${valueParam(value, 'Array(String)')}`;
      }
      if (type === 'String' ? typeof value !== 'string' : !Number.isInteger(value) || value < 0 || value > 255) throw new Error('Invalid ClickHouse metadata value');
      return `${field} = ${valueParam(value, type)}`;
    }
    if (input.range) {
      const entries = Object.entries(input.range);
      if (entries.length !== 1 || entries[0][0] !== 'partition') throw new Error('Only partition range filters are supported');
      const operators = { lt: '<', lte: '<=', gt: '>', gte: '>=' }, bounds = Object.entries(entries[0][1]);
      if (!bounds.length || bounds.some(([op, n]) => !operators[op] || !Number.isFinite(n))) throw new Error('Invalid partition bounds');
      return '(' + bounds.map(([op, value]) => `partition ${operators[op]} ${valueParam(value, 'Float64')}`).join(' AND ') + ')';
    }
    if (input.bool) {
      if (Object.keys(input.bool).some(key => !['filter', 'must', 'must_not'].includes(key))) throw new Error('Unsupported ClickHouse Boolean filter');
      const parts = [];
      for (const key of ['filter', 'must']) if (input.bool[key]) parts.push(walk(input.bool[key]));
      if (input.bool.must_not) for (const clause of Array.isArray(input.bool.must_not) ? input.bool.must_not : [input.bool.must_not]) parts.push(`NOT (${walk(clause)})`);
      return parts.length ? '(' + parts.join(' AND ') + ')' : '1';
    }
    throw new Error('Unsupported ClickHouse metadata filter');
  };
  const clauses = [];
  if (eligibleIds != null) clauses.push(`id IN ${valueParam(eligibleIds, 'Array(String)')}`);
  if (excludedIds?.length) clauses.push(`id NOT IN ${valueParam(excludedIds, 'Array(String)')}`);
  if (filter) clauses.push(walk(filter));
  return clauses.length ? clauses.join(' AND ') : '1';
}
export function buildClickHouseQuery({ query, limit = 20, eligibleIds, excludedIds, filter, parameters = {}, table = CLICKHOUSE_REAL_TABLE }) {
  const check = supportsClickHouse(query, { eligibleIds });
  if (!check.supported) throw new Error(check.reason);
  if (Object.keys(parameters).some(key => key !== 'minimumSupport')) throw new Error('Unsupported ClickHouse precision parameter');
  if (!Number.isInteger(limit) || limit < 1 || limit > 10000) throw new Error('ClickHouse limit must be1..10000');
  const source = buildPrecisionTypedQuery({ query, limit, parameters, eligibleIds }).query.script_score.script.params;
  const params = { ...source, limit };
  const where = filtersToSQL({ eligibleIds, excludedIds, filter, params });
  const sql = `WITH
  arrayMap((l,a,b) -> sqrt((l-{anchorL:Float64})*(l-{anchorL:Float64}) + (a-{anchorA:Float64})*(a-{anchorA:Float64}) + (b-{anchorB:Float64})*(b-{anchorB:Float64})), palette_l,palette_a,palette_b) AS distances,
  arrayMap(d -> if({radius:Float64}>0,d/{radius:Float64},if(d<1e-8,0.0,1e30)),distances) AS normalized,
  arraySum(arrayMap((d,w) -> if(d<=1.000000001,w,0.0),normalized,palette_w)) AS area,
  arraySum(arrayMap((d,w) -> if(d<=1.000000001,w*(1.0-(1.0-{edgeWeight:Float64})*least(1.0,d)),0.0),normalized,palette_w)) AS quality_mass
SELECT id, toFloat32(if(area>0,least(1.0,area/{minimumSupport:Float64})*(quality_mass/area),0.0)) AS score
FROM ${safeClickHouseTable(table)} WHERE ${where}
ORDER BY score DESC,id ASC LIMIT {limit:UInt32} FORMAT JSON`;
  return { sql, params, table };
}
export async function searchClickHouse(options) {
  const maxThreads = options.maxThreads ?? 8;
  if (!Number.isInteger(maxThreads) || maxThreads < 1 || maxThreads > 8) throw new Error('ClickHouse maxThreads must be an integer from1 to8');
  const request = buildClickHouseQuery(options);
  const timeoutMs = options.timeoutMs ?? 10000;
  const maxExecutionSeconds = options.serviceTimeout ? Number.parseFloat(options.serviceTimeout) / (String(options.serviceTimeout).endsWith('ms') ? 1000 : 1) : 10;
  const response = await clickHouseRequest(request.sql, { params: request.params, signal: options.signal, timeoutMs, settings: { max_threads: maxThreads, max_memory_usage: 2147483648, max_execution_time: maxExecutionSeconds, timeout_before_checking_execution_speed: 0, timeout_overflow_mode: 'throw', use_query_cache: 0, cancel_http_readonly_queries_on_client_close: 1 } });
  if (!Array.isArray(response.body.data)) throw new Error('Missing ClickHouse result rows');
  const seen = new Set();
  const hits = response.body.data.map(row => {
    if (typeof row.id !== 'string' || !Number.isFinite(row.score) || seen.has(row.id)) throw new Error('Invalid or duplicate ClickHouse hit');
    seen.add(row.id); return { id: row.id, score: row.score };
  });
  return { hits, evidence: { engine: 'clickhouse', table: request.table, maxThreads, httpMs: response.httpMs, serviceTookMs: response.body.statistics?.elapsed * 1000, rowsRead: response.body.statistics?.rows_read, bytesRead: response.body.statistics?.bytes_read, queryId: response.queryId, summary: response.summary, finalGloballyEligible: true, retrieval: 'exact-stored-objective' } };
}
