// Exact minimum-cost palette allocation runs wholly inside OpenSearch Painless.
import { RGB4096_CENTERS } from './corpus-colors.mjs';
import { interpretQuery, targetCellWeights, metadataFilter } from './query.mjs';

export const TRANSPORT_METHOD = Object.freeze({
  id: 'palette-transport-exact', label: 'Palette32 exclusive portion transport', family: 'transport',
  representation: 'palette32', approximate: false, searchKind: 'transport',
  limitations: [
    'Explicit proportions only. Each palette mass is allocated to exactly one requested portion or remainder.',
    'Remainder accepts unrequested colors for free, but charges excess requested-family mass.',
    'Optimal assignment on quantized palette centroids is exact; pixel representation and hand-authored costs are approximations.',
    'Per-document min-cost flow is expensive and must pass the same latency rejection threshold.',
  ],
});

export const TRANSPORT_SCRIPT = `
int n = doc['palette32_packed'].size();
int requested = params.demands.size();
int m = requested + (params.remainder > 0 ? 1 : 0);
int source = n + m; int sink = source + 1; int size = sink + 1;
double[][] capacity = new double[size][size];
double[][] cost = new double[size][size];
double total = doc['palette_total'].value;
for (int i = 0; i < n; i++) {
  long packed = doc['palette32_packed'].get(i);
  long rgb = packed / 65536L;
  int cell = (int)(((rgb >> 20) << 8) + (((rgb >> 12) & 15) << 4) + ((rgb >> 4) & 15));
  double mass = (packed % 65536L) / total;
  capacity[source][i] = mass;
  double union = 0;
  for (int j = 0; j < requested; j++) union = Math.max(union, params.weights[j][cell]);
  for (int j = 0; j < m; j++) {
    double price;
    if (j == requested) price = union * params.excessPenalty;
    else if (params.weights[j][cell] > 0) price = params.qualityPenalty * (1.0 - params.qualities[j][cell]);
    else price = union > 0 ? 1.0 : params.outsidePenalty;
    capacity[i][n + j] = mass;
    cost[i][n + j] = price;
    cost[n + j][i] = -price;
  }
}
for (int j = 0; j < m; j++) capacity[n + j][sink] = j == requested ? params.remainder : params.demands[j];
double[] potential = new double[size];
double flow = 0.0; double totalCost = 0.0; int iteration = 0;
while (flow < 1.0 - 1e-10) {
  if (++iteration > 2048) throw new IllegalArgumentException('Transport did not converge');
  double[] distance = new double[size];
  boolean[] visited = new boolean[size];
  int[] previous = new int[size];
  for (int v = 0; v < size; v++) { distance[v] = 1e30; previous[v] = -1; }
  distance[source] = 0.0;
  for (int step = 0; step < size; step++) {
    int u = -1; double best = 1e30;
    for (int v = 0; v < size; v++) if (!visited[v] && distance[v] < best) { best = distance[v]; u = v; }
    if (u < 0) break;
    visited[u] = true;
    for (int v = 0; v < size; v++) {
      if (visited[v] || capacity[u][v] <= 1e-12) continue;
      double reduced = cost[u][v] + potential[u] - potential[v];
      double next = distance[u] + Math.max(0.0, reduced);
      if (next < distance[v] - 1e-14) { distance[v] = next; previous[v] = u; }
    }
  }
  if (previous[sink] < 0) throw new IllegalArgumentException('Transport demand is infeasible');
  for (int v = 0; v < size; v++) if (distance[v] < 1e29) potential[v] += distance[v];
  double amount = 1.0 - flow;
  for (int v = sink; v != source; v = previous[v]) amount = Math.min(amount, capacity[previous[v]][v]);
  for (int v = sink; v != source; v = previous[v]) {
    int u = previous[v];
    capacity[u][v] -= amount; capacity[v][u] += amount;
    totalCost += amount * cost[u][v];
  }
  flow += amount;
}
return 1.0 / (1.0 + Math.max(0.0, totalCost));
`;

export function supportsTransport(query) {
  const compiled = interpretQuery(query);
  if (!compiled.supported) return compiled;
  if (compiled.mode !== 'proportions') return { supported: false, reason: 'Palette transport needs explicit portion percentages; it has no unspecified vibe objective.' };
  if (compiled.requested > 1 + 1e-9) return { supported: false, reason: 'Transport allocates exclusive portions; overlapping totals above 100% are unsupported.' };
  if (compiled.targets.some(t => ['monochromatic', 'rainbow'].includes(t.name))) return { supported: false, reason: 'Global hue-distribution properties are not pixel allocation regions.' };
  return { supported: true, compiled, warnings: TRANSPORT_METHOD.limitations };
}

export function buildTransportQuery({ query, limit = 20, eligibleIds, excludedIds, filter, parameters = {} }) {
  const check = supportsTransport(query);
  if (!check.supported) throw new Error(check.reason);
  const compiled = check.compiled;
  const weights = targetCellWeights(compiled, RGB4096_CENTERS);
  const qualityPenalty = parameters.qualityPenalty ?? 0.35;
  const outsidePenalty = parameters.outsidePenalty ?? 6;
  const excessPenalty = parameters.excessPenalty ?? 1;
  if ([qualityPenalty, outsidePenalty, excessPenalty].some(x => !Number.isFinite(x) || x < 0)) throw new Error('Transport penalties must be nonnegative.');
  return { size: limit, _source: false, track_total_hits: false, sort: [{ _score: 'desc' }, { id: 'asc' }],
    query: { script_score: { query: metadataFilter({ eligibleIds, excludedIds, filter, compiled }), script: { lang: 'painless', source: TRANSPORT_SCRIPT, params: {
      demands: compiled.targets.map(t => t.amount), remainder: compiled.remainder,
      weights: weights.map(w => w.area), qualities: weights.map(w => w.quality), qualityPenalty, outsidePenalty, excessPenalty,
    } } } } };
}
