// THROWAWAY PROTOTYPE: globally rank exact joint area from indexed family unions.
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { NATIVE_FAMILIES } from "./global-native.mjs";
import { minCostTransport } from "./proportions.mjs";
import { containsRange } from "./ranges.mjs";
import { api, bulk, recreateIndex, saveJson, metadataProperties } from "./global-common.mjs";

export const JOINT_EPSILON = 1e-10;
const FAMILY_IDS = NATIVE_FAMILIES.map((family) => family.id).sort();
const FAMILY_SET = new Set(FAMILY_IDS);
export const unionKey = (a, b) => [a, b].sort().join("__");
export const JOINT_PAIRS = FAMILY_IDS.flatMap((a, i) => FAMILY_IDS.slice(i + 1).map((b) => [a, b]));
export const JOINT_PROPERTIES = {
  id: { type: "keyword" },
  ...Object.fromEntries(FAMILY_IDS.map((id) => [`covj_${id}`, { type: "double", index: true, doc_values: true }])),
  ...Object.fromEntries(JOINT_PAIRS.map(([a, b]) => [`unionj_${unionKey(a, b)}`, { type: "double", index: true, doc_values: true }])),
};

function fraction(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < -JOINT_EPSILON || value > 1 + JOINT_EPSILON) throw new Error(`${label} must be a finite image fraction between 0 and 1.`);
  return Math.max(0, Math.min(1, value));
}

function consistentUnion(value, a, b, label) {
  const lower = Math.max(a, b), upper = Math.min(1, a + b);
  const union = fraction(value, label);
  if (union < lower - JOINT_EPSILON || union > upper + JOINT_EPSILON) throw new Error(`${label} is inconsistent with its family coverages.`);
  return Math.max(lower, Math.min(upper, union));
}

export function toJointDocument(doc) {
  if (typeof doc.id !== "string" || !doc.id) throw new Error("Joint documents require a stable string id.");
  const result = { id: doc.id };
  for (const id of FAMILY_IDS) result[`covj_${id}`] = fraction(doc.features?.[id], `Coverage ${id}`);
  for (const [a, b] of JOINT_PAIRS) {
    const key = unionKey(a, b);
    result[`unionj_${key}`] = consistentUnion(doc.unions?.[key], result[`covj_${a}`], result[`covj_${b}`], `Union ${key}`);
  }
  return result;
}

export function normalizeJointQuery(input) {
  if (!Array.isArray(input) || !input.length || input.length > 18) throw new Error("Choose one or two indexed families.");
  const merged = new Map();
  for (const color of input) {
    if (!color || !FAMILY_SET.has(color.family)) throw new Error("Unknown indexed color family.");
    if (typeof color.amount !== "number" || !Number.isFinite(color.amount) || color.amount < 0 || color.amount > 1) throw new Error("Each requested image amount must be between 0 and 1.");
    merged.set(color.family, (merged.get(color.family) ?? 0) + color.amount);
  }
  const colors = [...merged].sort(([a], [b]) => a.localeCompare(b)).map(([family, amount]) => ({ family, amount }));
  if (colors.length > 2) throw new Error("Joint union prototype supports at most two distinct families.");
  const total = colors.reduce((sum, color) => sum + color.amount, 0);
  if (total > 1 + JOINT_EPSILON) throw new Error("Requested image proportions exceed 100%.");
  if (total > 1) colors.reduce((a, b) => a.amount > b.amount ? a : b).amount -= total - 1;
  // Preserve explicit zero amounts: exact 0% is a useful absence preference.
  return colors;
}

function configuration(input, options) {
  const colors = normalizeJointQuery(input), mode = options.mode ?? "target";
  if (!["target", "minimum"].includes(mode)) throw new Error("Mode must be target or minimum.");
  if (options.boundary !== undefined && options.boundary !== "hard") throw new Error("The joint union prototype supports hard membership only.");
  if (options.qualityTieBreak) throw new Error("Joint center-quality tie-breaking is not implemented.");
  const maxError = options.maxError;
  if (maxError !== undefined && (typeof maxError !== "number" || !Number.isFinite(maxError) || maxError < 0 || maxError > 1)) throw new Error("maxError must be between 0 and 1.");
  return { colors, mode, maxError };
}

function jointCost(ca, cb, union, a, b, mode) {
  const requested = a + b;
  const accepted = Math.min(requested, union, a + cb, b + ca);
  return Math.max(0, Math.min(1, (mode === "minimum" ? requested : Math.max(requested, union)) - accepted));
}

export function jointReference(doc, input, options = {}) {
  const { colors, mode, maxError } = configuration(input, options);
  const coverage = (id) => fraction(doc[`covj_${id}`] ?? doc.features?.[id], `Coverage ${id}`);
  const ca = coverage(colors[0].family), a = colors[0].amount;
  let cost;
  if (colors.length === 1) cost = mode === "minimum" ? Math.max(0, a - ca) : Math.abs(ca - a);
  else {
    const cb = coverage(colors[1].family), b = colors[1].amount;
    const key = unionKey(colors[0].family, colors[1].family);
    const union = consistentUnion(doc[`unionj_${key}`] ?? doc.unions?.[key], ca, cb, `Union ${key}`);
    cost = jointCost(ca, cb, union, a, b, mode);
  }
  const score = Math.fround(Math.max(0, Math.min(1, 1 - cost)));
  return { cost, error: cost, score, exactScore: 1 - cost, sort: [score, doc.id], eligible: maxError === undefined || cost <= maxError + JOINT_EPSILON, colors, mode };
}

export const JOINT_SCRIPT = `
double ca = doc[params.af].value;
double a = params.a;
double error;
if (params.single) {
  error = params.minimum ? Math.max(0, a-ca) : Math.abs(ca-a);
} else {
  double cb = doc[params.bf].value;
  double union = doc[params.uf].value;
  double b = params.b;
  double requested = a+b;
  double accepted = Math.min(Math.min(requested,union), Math.min(a+cb,b+ca));
  error = (params.minimum ? requested : Math.max(requested,union))-accepted;
}
error = Math.max(0,Math.min(1,error));
if (params.bounded && error > (double)params.maxError + 0.0000000001) return 0;
return Math.max(0,Math.min(1,1-error));
`.trim();

export function jointQuery(input, options = {}) {
  const { colors, mode, maxError } = configuration(input, options);
  const size = options.size ?? 20;
  if (!Number.isInteger(size) || size < 1 || size > 10000) throw new Error("Page size must be between 1 and 10000.");
  const metadataFilters = options.filters ?? [];
  if (!Array.isArray(metadataFilters)) throw new Error("filters must be an array of OpenSearch filter clauses.");
  const filters = [...metadataFilters];
  const a = colors[0], b = colors[1];
  const af = `covj_${a.family}`, bf = b ? `covj_${b.family}` : "", uf = b ? `unionj_${unionKey(a.family, b.family)}` : "";
  if (maxError !== undefined) {
    const tolerance = maxError + JOINT_EPSILON;
    if (!b) {
      const range = { gte: Math.max(0, a.amount - tolerance) };
      if (mode === "target") range.lte = Math.min(1, a.amount + tolerance);
      filters.push({ range: { [af]: range } });
    } else {
      const requested = a.amount + b.amount;
      filters.push({ range: { [af]: { gte: Math.max(0, a.amount - tolerance) } } });
      filters.push({ range: { [bf]: { gte: Math.max(0, b.amount - tolerance) } } });
      const unionRange = { gte: Math.max(0, requested - tolerance) };
      if (mode === "target") unionRange.lte = Math.min(1, requested + tolerance);
      filters.push({ range: { [uf]: unionRange } });
    }
  }
  const query = { script_score: {
    query: filters.length ? { bool: { filter: filters } } : { match_all: {} },
    script: { lang: "painless", source: JOINT_SCRIPT, params: {
      af, bf, uf, a: a.amount, b: b?.amount ?? 0, single: !b,
      minimum: mode === "minimum", bounded: maxError !== undefined, maxError: maxError ?? 1,
    } },
  } };
  const body = {
    size, _source: options._source ?? false,
    track_total_hits: options.track_total_hits ?? true,
    query, sort: [{ _score: "desc" }, { id: "asc" }],
  };
  if (maxError !== undefined) body.min_score = Math.max(0, 1 - maxError - JOINT_EPSILON);
  if (options.pit !== undefined) body.pit = options.pit;
  if (options.search_after !== undefined) body.search_after = options.search_after;
  if (options.profile) body.profile = true;
  return body;
}

function analyticalDocument(id, masses) {
  // Four concrete colors realize neither, dark-only, blue-only, and dark+blue.
  const hexes = ["#FF0000", "#101010", "#2060D0", "#102030"];
  const membership = hexes.map((hex) => {
    const rgb = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255);
    return Object.fromEntries(NATIVE_FAMILIES.map((family) => [family.id, containsRange(rgb, { ...family, amount: 1 })]));
  });
  assert.deepEqual(membership.map((entry) => (entry.dark ? 1 : 0) | (entry.blue ? 2 : 0)), [0, 1, 2, 3]);
  const features = Object.fromEntries(FAMILY_IDS.map((family) => [family, masses.reduce((sum, weight, i) => sum + (membership[i][family] ? weight : 0), 0)]));
  const unions = Object.fromEntries(JOINT_PAIRS.map(([a, b]) => [unionKey(a, b), masses.reduce((sum, weight, i) => sum + (membership[i][a] || membership[i][b] ? weight : 0), 0)]));
  return { id, features, unions };
}

export async function probeJoint() {
  const index = "color-global-joint-probe";
  const summary = { families: FAMILY_IDS.length, pairUnions: JOINT_PAIRS.length, closedFormChecks: 0, nativeQueries: 0, boundQueries: 0, boundaryEpsilon: JOINT_EPSILON, float32ScoreAgreement: true };
  const source = [];
  for (let m0 = 0; m0 <= 5; m0++) for (let m1 = 0; m1 <= 5 - m0; m1++) for (let m2 = 0; m2 <= 5 - m0 - m1; m2++) {
    const masses = [m0, m1, m2, 5 - m0 - m1 - m2].map((v) => v / 5);
    const doc = analyticalDocument(`joint-${String(source.length).padStart(3, "0")}`, masses);
    source.push(doc);
    for (let a = 0; a <= 5; a++) for (let b = 0; b <= 5 - a; b++) for (const mode of ["target", "minimum"]) {
      const colors = [{ family: "dark", amount: a / 5 }, { family: "blue", amount: b / 5 }];
      const matrix = [0, 1, 2, 3].map((mask) => [mask & 1 ? 0 : 1, mask & 2 ? 0 : 1, mode === "minimum" ? 0 : mask ? 1 : 0]);
      const oracle = minCostTransport(masses, [a / 5, b / 5, 1 - (a + b) / 5], matrix).cost;
      assert.ok(Math.abs(jointReference(doc, colors, { mode }).cost - oracle) < 1e-9);
      summary.closedFormChecks++;
    }
  }
  // Exercise arbitrary fractions, close float32 scores, and inclusive thresholds.
  for (const delta of [-2e-9, -2e-10, -5e-11, 0, 5e-11, 2e-10, 2e-9, .000001, .00002]) {
    const dark = .6 + delta;
    source.push(analyticalDocument(`boundary-${source.length}`, [1 - dark, dark, 0, 0]));
  }
  assert.throws(() => normalizeJointQuery([{ family: "dark", amount: .7 }, { family: "blue", amount: .4 }]));
  assert.throws(() => normalizeJointQuery(["dark", "blue", "red"].map((family) => ({ family, amount: .2 }))));
  assert.throws(() => toJointDocument({ id: "missing-unions", features: source[0].features }));
  assert.throws(() => jointQuery([{ family: "red", amount: .4 }], { boundary: "graded" }));
  assert.equal(normalizeJointQuery([{ family: "dark", amount: .2 }, { family: "dark", amount: .2 }]).length, 1);
  source.forEach((doc, i) => { doc.cohort = i % 2 ? "odd" : "even"; });
  await recreateIndex(index, { ...metadataProperties, ...JOINT_PROPERTIES }, { number_of_shards: 3 });
  await bulk(index, source.map((doc) => ({ ...toJointDocument(doc), cohort: doc.cohort })));
  await api(`/${index}/_refresh`, {}, "POST");
  const cases = [
    [{ family: "dark", amount: .4 }],
    [{ family: "dark", amount: 0 }],
    [{ family: "dark", amount: 1 }],
    [{ family: "blue", amount: .7 }],
    [{ family: "dark", amount: .4 }, { family: "blue", amount: .6 }],
    [{ family: "dark", amount: .4 }, { family: "blue", amount: .4 }],
    [{ family: "dark", amount: .7 }, { family: "blue", amount: .3 }],
    [{ family: "dark", amount: 0 }, { family: "blue", amount: .5 }],
    [{ family: "dark", amount: 0 }, { family: "blue", amount: 0 }],
  ];
  const complete = (response) => {
    assert.equal(response.timed_out, false);
    assert.equal(response._shards.failed, 0);
    return response;
  };
  for (const colors of cases) for (const mode of ["target", "minimum"]) for (const maxError of [undefined, 0, .05, .2, .6, 1]) for (const filtered of [false, true]) {
    const options = { mode, maxError, size: 1000, filters: filtered ? [{ term: { cohort: "even" } }] : [] };
    const expected = source.filter((doc) => !filtered || doc.cohort === "even")
      .map((doc) => ({ id: doc.id, ...jointReference(doc, colors, options) }))
      .filter((doc) => doc.eligible)
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    const response = complete((await api(`/${index}/_search`, jointQuery(colors, options))).body);
    assert.equal(response.hits.total.value, expected.length, JSON.stringify({ colors, mode, maxError, filtered }));
    assert.deepEqual(response.hits.hits.map((hit) => hit._id), expected.map((doc) => doc.id));
    // OpenSearch serializes float scores using Java's shortest float string;
    // e.g. JSON 0.8 represents the float32 value 0.800000011920929.
    response.hits.hits.forEach((hit, i) => assert.equal(Math.fround(hit._score), expected[i].score));
    summary.nativeQueries++;
    if (maxError !== undefined) summary.boundQueries++;
  }
  const pit = (await api(`/${index}/_search/point_in_time?keep_alive=2m`, {})).body;
  let search_after, ids = [];
  const colors = cases[4], options = { mode: "target", maxError: .6, filters: [{ term: { cohort: "even" } }], size: 7, pit: { id: pit.pit_id, keep_alive: "2m" } };
  try {
    while (true) {
      const result = complete((await api("/_search", jointQuery(colors, { ...options, search_after }))).body);
      if (!result.hits.hits.length) break;
      ids.push(...result.hits.hits.map((hit) => hit._id));
      search_after = result.hits.hits.at(-1).sort;
    }
    const expected = source.filter((doc) => doc.cohort === "even").map((doc) => ({ id: doc.id, ...jointReference(doc, colors, options) })).filter((doc) => doc.eligible).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    assert.deepEqual(ids, expected.map((doc) => doc.id));
    assert.equal(new Set(ids).size, ids.length);
    summary.filteredBoundedPitDocuments = ids.length;
  } finally { await api("/_search/point_in_time", { pit_id: [pit.pit_id] }, "DELETE"); }
  summary.documents = source.length;
  summary.passed = true;
  await saveJson("global-joint-probe.json", summary);
  process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
  return summary;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href && process.argv.includes("--probe")) await probeJoint();
