// File-only presentation of an explicitly published experiment checkpoint.
// This module does not import a search client, scorer or benchmark runner.
import { open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

export const FAVORITE_PERFORMANCE_ROOT = '/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/favorite-optimization/2026-09-23';
export const FAVORITE_PERFORMANCE_FILE = `${FAVORITE_PERFORMANCE_ROOT}/favorite-performance-public-summary.json`;
const MAX_BYTES = 8 * 1024 * 1024;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const cohortDefinitions = [
  ['real-545', '545-image correctness corpus', '523 real images plus 22 synthetic fixtures. Human preference feedback uses one observer’s development judgments, not population accuracy or capacity evidence.'],
  ['projection-1m', '1 million · narrow projection', 'Synthetic records with only the utility fields used by a small fixed query set. This measures scoring at scale; it does not measure a complete color index.'],
  ['full-100k', '100,000 · full schema', 'Synthetic records with the full schema of each listed method. Check each campaign’s index and utility count; earlier baseline and newer precomputed schemas differ.'],
  ['full-1m', '1 million · full schema', 'Full-schema indexing and query capacity are separate measurements. A completed build alone does not establish query latency or throughput.'],
  ['other', 'Earlier / other scopes', 'Other counts or missing scope metadata are kept here, never promoted to full-million evidence.'],
];

function cohortId(item) {
  const count = item.count ?? item.requestedCount;
  if (count === 545) return 'real-545';
  if (item.scope === 'projection' && count === 1_000_000) return 'projection-1m';
  if (item.scope === 'full' && count === 100_000) return 'full-100k';
  if (item.scope === 'full' && count === 1_000_000) return 'full-1m';
  return 'other';
}
function artifactLabel(artifact) {
  if (!artifact?.path) return 'Unknown artifact';
  const relative = path.relative(FAVORITE_PERFORMANCE_ROOT, artifact.path);
  return relative.startsWith('..') || path.isAbsolute(relative) ? path.basename(path.dirname(artifact.path)) + '/' + path.basename(artifact.path) : relative;
}
function profileStatus(row, campaign) {
  if (row.timed?.strictFailures > 0 || row.strictWarmupFailures > 0 || row.viableAtTestedLoad === false) return 'failed';
  if (!campaign.complete) return 'incomplete';
  const p95 = campaign.kind === 'arrivals' ? row.p95EndToEndMs : row.p95SuccessfulMs;
  if (row.viableAtTestedLoad !== true || !(row.timed?.requests > 0) || row.timed?.strictFailures !== 0 ||
    row.strictWarmupFailures !== 0 || !Number.isFinite(p95)) return 'unmeasured';
  return 'passed';
}

export function buildFavoritePerformanceView(summary) {
  if (summary?.schemaVersion !== 1 || summary.root !== FAVORITE_PERFORMANCE_ROOT ||
    !Number.isFinite(Date.parse(summary.generatedAt)) ||
    !['performance', 'feedback', 'indexes', 'fidelity', 'warnings'].every(key => Array.isArray(summary[key]))) throw Error('Invalid performance summary.');
  const publication = summary.publication;
  if (!publication || !Number.isFinite(Date.parse(publication.publishedAt)) ||
    typeof publication.sourceCheckpoint !== 'string' || path.basename(publication.sourceCheckpoint) !== publication.sourceCheckpoint ||
    !/^[a-f0-9]{64}$/.test(publication.sourceSha256)) throw Error('Invalid performance summary publication.');
  const cohorts = cohortDefinitions.map(([id, title, description]) => {
    const campaigns = summary.performance.flatMap(campaign => {
      const profiles = (campaign.profiles ?? []).filter(row => cohortId(row) === id)
        .map(row => ({ ...row, status: profileStatus(row, campaign) }));
      const scopeIndexes = (campaign.indexes ?? []).filter(index => cohortId(index) === id);
      if (!profiles.length && (campaign.complete || !scopeIndexes.length)) return [];
      const usedIndexes = new Set(profiles.map(row => row.index));
      for (const index of scopeIndexes) usedIndexes.add(index.index);
      return [{ id: artifactLabel(campaign.artifact), artifactSha256: campaign.artifact?.sha256 ?? null,
        kind: campaign.kind, complete: campaign.complete === true, finishedAt: campaign.finishedAt ?? null,
        interruption: campaign.interruption ?? null, profiles, sourceSnapshotHash: campaign.sourceSnapshotHash ?? null,
        indexes: (campaign.indexes ?? []).filter(index => usedIndexes.has(index.index)),
        configuration: campaign.configuration, skipped: campaign.skipped ?? [], warmup: campaign.warmup,
        timed: campaign.timed ?? null, completedTimed: campaign.completedTimed ?? null,
        timedCoverage: campaign.timedCoverage ?? (campaign.complete ? 'completed-profile-set' : 'completed-profiles-only'),
        pendingEvidence: campaign.complete ? null : campaign.pendingEvidence ?? { status: 'unavailable', timed: null,
          reason: 'This older snapshot does not include independently reconciled pending request evidence.' },
        limitations: campaign.limitations ?? [] }];
    });
    const profiles = campaigns.flatMap(campaign => campaign.profiles);
    const measured = profiles.filter(row => row.timed?.requests > 0);
    return { id, title, description, campaigns,
      indexes: summary.indexes.filter(index => cohortId(index) === id).map(index => ({ ...index, artifact: artifactLabel(index.artifact) })),
      hasMeasurements: measured.length > 0,
      measuredConcurrencies: [...new Set(measured.map(row => row.concurrency).filter(Number.isFinite))].sort((a, b) => a - b),
      measuredArrivalRates: [...new Set(measured.map(row => row.arrivalRate).filter(Number.isFinite))].sort((a, b) => a - b) };
  });
  return { schemaVersion: 1, generatedAt: summary.generatedAt, publishedAt: publication.publishedAt,
    sourceCheckpoint: publication.sourceCheckpoint, sourceSha256: publication.sourceSha256,
    cohorts, feedback: summary.feedback.map(run => ({ ...run, artifact: artifactLabel(run.artifact) })),
    fidelity: summary.fidelity.map(run => ({ artifact: artifactLabel(run.artifact), complete: run.complete,
      passed: run.passed, executionPassed: run.executionPassed, intendedArithmeticPassed: run.intendedArithmeticPassed,
      duplicateDiagnosticCount: run.duplicateDiagnostics?.length ?? 0 })),
    warnings: summary.warnings.map(warning => ({ artifact: artifactLabel({ path: warning.artifact }), error: warning.error })),
    interpretation: summary.interpretation ?? [],
    caveats: [
      'Scale measurements use synthetic mixtures of real image measurements, not one million independently collected wallpapers.',
      'Scale performance campaigns: one shared host, one OpenSearch node, one primary shard and zero replicas; 8 CPU limit, 4 GiB heap, 12 GiB memory limit.',
      'Warm, repeated closed-loop queries self-throttle. They do not establish cold-cache performance, changing-color cache behavior or concurrent-user capacity.',
      'Earlier projections and the 100k pilot had other indexes open. Those inactive indexes were closed before the full-million build. Compare methods within each campaign.',
      'A strict failure is an error, invalid latency, or a request taking at least 1,000 ms. Warmup failures remain separate and also affect viability.',
      'No full-million or 100-million performance is extrapolated from a smaller or narrower index. Missing measurements remain unmeasured.',
    ] };
}

export async function readFavoritePerformance({ openFile = open } = {}) {
  let handle;
  try {
    handle = await openFile(FAVORITE_PERFORMANCE_FILE, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_BYTES) throw Error('Invalid summary file.');
    const bytes = await handle.readFile();
    if (bytes.length > MAX_BYTES) throw Error('Oversized summary file.');
    return { ...buildFavoritePerformanceView(JSON.parse(bytes.toString('utf8'))), summarySha256: hash(bytes) };
  } catch {
    const error = Error('The published performance snapshot is unavailable. Please try again after it has been refreshed.');
    error.status = 503;
    throw error;
  } finally { await handle?.close(); }
}
