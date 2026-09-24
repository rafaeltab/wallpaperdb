import test from 'node:test';
import assert from 'node:assert/strict';
import { constants } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { FAVORITE_PERFORMANCE_ROOT, FAVORITE_PERFORMANCE_FILE, buildFavoritePerformanceView, readFavoritePerformance } from './favorite-performance.mjs';

const artifact = name => ({ path: `${FAVORITE_PERFORMANCE_ROOT}/${name}/benchmark.json`, sha256: 'a'.repeat(64) });
const fixture = () => ({ schemaVersion: 1, root: FAVORITE_PERFORMANCE_ROOT, generatedAt: '2026-09-23T16:00:00Z',
  publication: { sourceCheckpoint: 'results-checkpoint-20260923-v5.json', publishedAt: '2026-09-23T16:01:00Z', sourceSha256: 'b'.repeat(64) },
  performance: [], feedback: [], indexes: [], fidelity: [], warnings: [], interpretation: [] });
const profile = (scope, count, extra = {}) => ({ method: 'numeric', candidateId: 'numeric', index: 'index', scope, count,
  queryId: 'two-colors', concurrency: 1, selectivity: 'all', p95SuccessfulMs: 42, p95EndToEndMs: null,
  timed: { requests: 20, errors: 0, atOrAboveOneSecond: 0, strictFailures: 0 }, strictWarmupFailures: 0, viableAtTestedLoad: true, ...extra });
const campaign = (profiles, extra = {}) => ({ artifact: artifact('campaign'), kind: 'closed-loop', complete: true,
  indexes: [], profiles, warmup: { strictFailures: 0 }, skipped: [], limitations: [], ...extra });

test('separates million projection, full100k, full1m, real corpus and unknown scope without inferring from names', () => {
  const summary = fixture(); summary.performance = [campaign([profile('projection', 1e6), profile('full', 1e5),
    profile('full', 1e6), profile('full', 545), profile('unknown', 1e6, { index: 'full-1m' })])];
  const result = buildFavoritePerformanceView(summary);
  for (const id of ['projection-1m', 'full-100k', 'full-1m', 'real-545', 'other']) assert.equal(result.cohorts.find(c => c.id === id).campaigns[0].profiles.length, 1);
});

test('keeps incomplete campaigns and strict errors visible even with fast successful p95', () => {
  const summary = fixture(); summary.performance = [campaign([profile('full', 1e5, { timed: { requests: 20, errors: 2, atOrAboveOneSecond: 1, strictFailures: 2 } })], { complete: false })];
  const row = buildFavoritePerformanceView(summary).cohorts.find(c => c.id === 'full-100k').campaigns[0].profiles[0];
  assert.equal(row.status, 'failed'); assert.equal(row.p95SuccessfulMs, 42); assert.equal(row.timed.strictFailures, 2);
  summary.performance[0].profiles[0].timed.strictFailures = 0;
  assert.equal(buildFavoritePerformanceView(summary).cohorts.find(c => c.id === 'full-100k').campaigns[0].profiles[0].status, 'incomplete');
});

test('missing viability, samples, warmup evidence or latency never becomes a pass; warmup failures remain failures', () => {
  for (const extra of [{ viableAtTestedLoad: null }, { timed: { requests: 0, strictFailures: 0 } },
    { strictWarmupFailures: null }, { p95SuccessfulMs: null }]) {
    const summary = fixture(); summary.performance = [campaign([profile('full', 1e5, extra)])];
    assert.equal(buildFavoritePerformanceView(summary).cohorts.find(c => c.id === 'full-100k').campaigns[0].profiles[0].status, 'unmeasured');
  }
  const summary = fixture(); summary.performance = [campaign([profile('full', 1e5, { strictWarmupFailures: 1 })])];
  assert.equal(buildFavoritePerformanceView(summary).cohorts.find(c => c.id === 'full-100k').campaigns[0].profiles[0].status, 'failed');
});

test('arrival latency stays separate and absent load levels remain unmeasured', () => {
  const summary = fixture(); summary.performance = [campaign([profile('full', 1e6, { concurrency: null, arrivalRate: 16,
    p95SuccessfulMs: null, p95EndToEndMs: 80 })], { kind: 'arrivals' })];
  const cohort = buildFavoritePerformanceView(summary).cohorts.find(c => c.id === 'full-1m');
  assert.deepEqual(cohort.measuredConcurrencies, []); assert.deepEqual(cohort.measuredArrivalRates, [16]);
  assert.equal(cohort.campaigns[0].profiles[0].p95EndToEndMs, 80); assert.equal(cohort.campaigns[0].profiles[0].p95SuccessfulMs, null);
});

test('unfinished full-million build has progress at snapshot but no invented performance result', () => {
  const summary = fixture(); summary.indexes = [{ artifact: artifact('build'), mode: 'scale', scope: 'full', requestedCount: 1e6,
    count: null, indexedCount: 46767, complete: false, utilityCount: 6138 }];
  const cohort = buildFavoritePerformanceView(summary).cohorts.find(c => c.id === 'full-1m');
  assert.equal(cohort.campaigns.length, 0); assert.equal(cohort.indexes[0].indexedCount, 46767);
  assert.equal(cohort.indexes[0].complete, false); assert.equal(cohort.hasMeasurements, false);
});

test('retains independent feedback support, errors and intended-arithmetic failures', () => {
  const summary = fixture(); summary.feedback = [{ runId: 'one', candidates: [{ method: 'numeric', coverage: { ok: 32, unsupported: 6 }, agreement: { queryMacroAgreement: .69 } }] }];
  summary.fidelity = [{ artifact: artifact('fidelity'), complete: true, passed: true, intendedArithmeticPassed: false, duplicateDiagnostics: [{ id: 'same-anchor' }] }];
  const result = buildFavoritePerformanceView(summary); assert.equal(result.feedback[0].candidates[0].coverage.unsupported, 6);
  assert.equal(result.fidelity[0].intendedArithmeticPassed, false); assert.equal(result.fidelity[0].duplicateDiagnosticCount, 1);
});

test('fixed-file reader never accepts paths and closes handles; uses O_NOFOLLOW and checks bytes', async () => {
  let closed = false;
  const bytes = Buffer.from(JSON.stringify(fixture()));
  const result = await readFavoritePerformance({ path: '/etc/passwd', openFile: async (filename, flags) => {
    assert.equal(filename, FAVORITE_PERFORMANCE_FILE); assert.ok(flags & constants.O_NOFOLLOW);
    return { stat: async () => ({ isFile: () => true, size: bytes.length }), readFile: async () => bytes, close: async () => { closed = true; } };
  } });
  assert.equal(closed, true); assert.equal(result.sourceCheckpoint, 'results-checkpoint-20260923-v5.json'); assert.match(result.summarySha256, /^[a-f0-9]{64}$/);
});

test('reader rejects missing, oversized, nonfile and malformed summary with a safe error', async () => {
  const cases = [async () => { throw Error('/private/path'); }, ...[
    { isFile: () => false, size: 1 }, { isFile: () => true, size: 9e6 }, { isFile: () => true, size: 1 },
  ].map(stat => async () => ({ stat: async () => stat, readFile: async () => Buffer.from('{'), close: async () => {} }))];
  for (const openFile of cases) await assert.rejects(readFavoritePerformance({ openFile }), error => error.status === 503 && !error.message.includes('/private'));
  const summary = fixture(); summary.root = '/other'; assert.throws(() => buildFavoritePerformanceView(summary), /summary/);
});

const interruptedCampaign = () => campaign([profile('full', 1e6, { timed: { requests: 85293, errors: 0, atOrAboveOneSecond: 0, strictFailures: 0 } })], {
  complete: false, interruption: 'fetch failed', timedCoverage: 'audited-raw-log',
  timed: { requests: 97578, errors: 7491, atOrAboveOneSecond: 0, strictFailures: 7491 },
  completedTimed: { requests: 85293, errors: 0, atOrAboveOneSecond: 0, strictFailures: 0 },
  pendingEvidence: { status: 'verified', timed: { requests: 12285, errors: 7491, atOrAboveOneSecond: 0, strictFailures: 7491 },
    warmup: { requests: 0, errors: 0, atOrAboveOneSecond: 0, strictFailures: 0 },
    audit: { path: '/audit.json', sha256: 'c'.repeat(64) }, rawRequests: { path: '/requests.jsonl', sha256: 'd'.repeat(64) },
    evidenceBoundary: 'Counters reconciled; raw log hashed at inventory time.' } });

test('interrupted raw failures remain separate from completed profiles and survive a pending-only cohort', () => {
  const summary = fixture(); summary.performance = [interruptedCampaign()];
  let run = buildFavoritePerformanceView(summary).cohorts.find(c => c.id === 'full-1m').campaigns[0];
  assert.equal(run.timed.errors, 7491); assert.equal(run.pendingEvidence.timed.requests, 12285);
  assert.equal(run.completedTimed.errors, 0); assert.equal(run.profiles.length, 1);
  assert.equal(run.profiles[0].status, 'incomplete'); assert.equal(run.complete, false);
  summary.performance[0].profiles = [];
  summary.performance[0].indexes = [{ index: 'index', scope: 'full', count: 1e6 }];
  run = buildFavoritePerformanceView(summary).cohorts.find(c => c.id === 'full-1m').campaigns[0];
  assert.equal(run.profiles.length, 0); assert.equal(run.pendingEvidence.timed.errors, 7491);
});

test('old incomplete snapshots explicitly report unavailable pending evidence', () => {
  const summary = fixture(); summary.performance = [campaign([profile('full', 1e6)], { complete: false })];
  const run = buildFavoritePerformanceView(summary).cohorts.find(c => c.id === 'full-1m').campaigns[0];
  assert.equal(run.pendingEvidence.status, 'unavailable'); assert.equal(run.pendingEvidence.timed, null);
  assert.equal(run.timedCoverage, 'completed-profiles-only');
});

test('page keeps unfinished errors visible when every completed profile is filtered out, without inventing a table row', async () => {
  // Minimal offline DOM exercises the actual page script; fetch serves only the
  // published view fixture, and no browser or OpenSearch service is contacted.
  class Element {
    constructor(tag) { this.tag = tag; this.children = []; this.events = {}; this.dataset = {}; this.value = ''; this.text = ''; }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = nodes; }
    set textContent(value) { this.text = String(value); this.children = []; }
    get textContent() { return this.text + this.children.map(child => child.textContent).join(' '); }
    get firstChild() { return this.children[0]; }
    setAttribute() {}
    addEventListener(name, fn) { this.events[name] = fn; }
  }
  const elements = new Map(), document = { createElement: tag => new Element(tag), querySelector: selector => {
    if (!elements.has(selector)) elements.set(selector, new Element(selector)); return elements.get(selector);
  } };
  const summary = fixture(); summary.performance = [interruptedCampaign()];
  const script = await readFile(new URL('./web/favorite-lab/performance.js', import.meta.url), 'utf8');
  let fetches = 0;
  runInNewContext(script, { document, Node: Element, fetch: async url => {
    assert.equal(url, '/api/performance'); fetches++; return { ok: true, json: async () => buildFavoritePerformanceView(summary) };
  } });
  await new Promise(resolve => setImmediate(resolve));
  document.querySelector('#cohorts').children.find(button => button.dataset.cohort === 'full-1m').events.click();
  const container = document.querySelector('#measurements');
  assert.match(container.textContent, /7,491 errors/); assert.match(container.textContent, /12,285 timed requests/);
  assert.match(container.textContent, /Campaign incomplete/);
  document.querySelector('#method-filter').value = 'no-matching-completed-profile';
  document.querySelector('#method-filter').events.change();
  assert.match(container.textContent, /7,491 errors/); assert.match(container.textContent, /no final profile latency/);
  const tables = node => Number(node.tag === 'table') + node.children.reduce((count, child) => count + tables(child), 0);
  assert.equal(tables(container), 0); assert.equal(fetches, 1);
});
