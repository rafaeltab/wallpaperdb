// Loopback-only HTTP client for the isolated ClickHouse prototype.
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
export const CLICKHOUSE_BASE = process.env.COLOR_EXPLORATION_CLICKHOUSE ?? 'http://127.0.0.1:19218';
export const CLICKHOUSE_REAL_TABLE = 'color_exploration_real_v1';
export const CLICKHOUSE_SCALE_TABLE = 'color_exploration_scale_v1';
export function safeClickHouseTable(table) {
  if (!/^color_exploration_[a-z0-9_]+$/.test(table)) throw new Error(`Unsafe ClickHouse scratch table: ${table}`);
  return table;
}
export function arrayParameter(values) {
  if (!Array.isArray(values) || values.some(value => typeof value !== 'string')) throw new Error('ID parameters must be string arrays');
  return '[' + values.map(value => "'" + value.replaceAll('\\', '\\\\').replaceAll("'", "\\'").replaceAll('\n', '\\n').replaceAll('\r', '\\r').replaceAll('\0', '\\0') + "'").join(',') + ']';
}
export async function clickHouseRequest(sql, { params = {}, settings = {}, signal, timeoutMs = 10000, data, base = CLICKHOUSE_BASE } = {}) {
  const queryId = `color-exploration-${randomUUID()}`, url = new URL(base);
  url.searchParams.set('query_id', queryId);
  url.searchParams.set('wait_end_of_query', '1');
  for (const [name, value] of Object.entries(params)) url.searchParams.set(`param_${name}`, String(value));
  for (const [name, value] of Object.entries(settings)) url.searchParams.set(name, String(value));
  const started = performance.now();
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'text/plain; charset=utf-8' },
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs), body: data == null ? sql : sql + '\n' + data });
  const text = await response.text();
  if (!response.ok || response.headers.has('x-clickhouse-exception-code') || /^Code: \d+/.test(text)) throw new Error(`ClickHouse ${response.status}: ${text.slice(0, 1800)}`);
  let body;
  try { body = text.trim() ? JSON.parse(text) : {}; }
  catch { throw new Error(`ClickHouse returned an incomplete or non-JSON response: ${text.slice(0, 300)}`); }
  if (body.exception) throw new Error(`ClickHouse query exception: ${body.exception}`);
  const summary = JSON.parse(response.headers.get('x-clickhouse-summary') ?? '{}');
  return { body, httpMs: performance.now() - started, queryId, summary };
}
export async function countTable(table = CLICKHOUSE_REAL_TABLE) {
  const response = await clickHouseRequest(`SELECT count() AS count, uniqExact(id) AS uniqueIds FROM ${safeClickHouseTable(table)} FORMAT JSON`);
  return { count: Number(response.body.data[0].count), uniqueIds: Number(response.body.data[0].uniqueIds) };
}
export async function clickHouseMetadata(table = CLICKHOUSE_REAL_TABLE) {
  const version = await clickHouseRequest('SELECT version() AS version, hostName() AS hostname FORMAT JSON');
  const parts = await clickHouseRequest('SELECT sum(rows) AS rows, sum(bytes_on_disk) AS bytesOnDisk, sum(data_uncompressed_bytes) AS uncompressedBytes, count() AS activeParts FROM system.parts WHERE active AND database=currentDatabase() AND table={table:String} FORMAT JSON', { params: { table: safeClickHouseTable(table) } });
  const metrics = await clickHouseRequest("SELECT metric,value FROM system.asynchronous_metrics WHERE metric IN ('MemoryResident','OSUserTime','OSSystemTime','CGroupMemoryUsed','CGroupMemoryLimit','CGroupMaxCPU') FORMAT JSON");
  return { version: version.body.data[0].version, hostname: version.body.data[0].hostname, table, parts: parts.body.data[0], metrics: Object.fromEntries(metrics.body.data.map(row => [row.metric, Number(row.value)])), containerLimits: { cpus: 8, memoryBytes: 12 * 1024 ** 3, source: 'clickhouse-compose.yml; compare with observed metrics' } };
}
