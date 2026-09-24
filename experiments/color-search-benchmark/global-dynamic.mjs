// THROWAWAY PROTOTYPE: exact hard-region ranking over every eligible OpenSearch doc.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { compileRangeQuery, prepareRangePalette, scoreRangePalette, RANGE_PRESETS } from "./ranges.mjs";
import { minCostTransport } from "./proportions.mjs";

export const SLOT_COUNT = 32;
export const MAX_REGIONS = 2;
export const ENDPOINT = "http://127.0.0.1:19216";
const EPS = 1e-7;
export const slotFields = Array.from({ length: SLOT_COUNT }, (_, i) =>
  ["w", "r", "g", "b", "L", "A", "B"].map((part) => `p${String(i).padStart(2, "0")}_${part}`),
);
export const mappingProperties = {
  id: { type: "keyword" },
  palette_size: { type: "integer", index: false },
  ...Object.fromEntries(slotFields.flat().map((field) => [field, { type: "double", index: false, doc_values: true }])),
};

function queryConfiguration(colors, options = {}) {
  if (options.boundary !== undefined && options.boundary !== "hard") throw new Error("Global dynamic prototype supports hard boundaries only; graded and soft ranking are not implemented.");
  const mode = options.mode ?? "target";
  if (!["target", "minimum"].includes(mode)) throw new Error("Mode must be target or minimum.");
  const query = compileRangeQuery(colors);
  if (query.targets.length > MAX_REGIONS) throw new Error("Global dynamic prototype supports at most two distinct color regions.");
  return { query, mode };
}

function documentPalette(doc) {
  const palette = doc.palette ?? doc.palette32;
  if (!Array.isArray(palette) || palette.length > SLOT_COUNT) throw new Error("Global dynamic documents need a palette of at most 32 entries.");
  return prepareRangePalette(palette);
}

export function toDynamicDocument(doc) {
  if (typeof doc.id !== "string" || !doc.id) throw new Error("A stable string document id is required.");
  const { points } = documentPalette(doc);
  const result = { id: doc.id, palette_size: points.length };
  points.forEach((point, i) => {
    const values = [point.weight, ...point.rgb, ...point.lab];
    slotFields[i].forEach((field, j) => { result[field] = values[j]; });
  });
  return result;
}

/** Exact min-cost binary transport for zero, one, or two overlapping regions. */
export function hardTransportCost(masses, amounts, mode = "target") {
  if (!Array.isArray(masses) || masses.length !== 4 || !masses.every((x) => Number.isFinite(x) && x >= 0)) throw new Error("Membership masses must contain four nonnegative finite values.");
  if (!Array.isArray(amounts) || amounts.length < 1 || amounts.length > 2 || !amounts.every((x) => Number.isFinite(x) && x >= 0)) throw new Error("One or two nonnegative region demands are required.");
  if (!["target", "minimum"].includes(mode)) throw new Error("Unknown proportion mode.");
  const total = masses.reduce((sum, x) => sum + x, 0);
  if (!(total > 0)) throw new Error("Membership masses must have positive total area.");
  const [m0, m1, m2, m3] = masses.map((x) => x / total);
  const a = amounts[0], b = amounts[1] ?? 0, requested = a + b;
  if (requested > 1 + 1e-11) throw new Error("Region demands exceed 100%.");
  // Maximum zero-cost assignment to requested destinations, by the four min cuts.
  const matched = Math.min(requested, m1 + m2 + m3, a + m2 + m3, b + m1 + m3);
  const cost = mode === "minimum" ? requested - matched : 1 - Math.min(m0, Math.max(0, 1 - requested)) - matched;
  return Math.max(0, Math.min(1, cost));
}

function inside(point, target) {
  for (const range of target.ranges) {
    if (range.space === "oklab") {
      if (Math.hypot(...point.lab.map((v, i) => v - target.lab[i])) > range.distance + EPS) return false;
    } else if (range.space === "rgb") {
      if (["r", "g", "b"].some((key, i) => Math.abs(point.rgb[i] - target.rgb[i]) > range[key] + EPS)) return false;
    } else {
      const p = point[range.space], t = target[range.space];
      if (range.h < 1) {
        if (p.h === null) return false;
        const difference = Math.abs(p.h - t.h);
        if (2 * Math.min(difference, 1 - difference) > range.h + EPS) return false;
      }
      const axis = range.space === "hsl" ? "l" : "v";
      if (Math.abs(p.s - t.s) > range.s + EPS || Math.abs(p[axis] - t[axis]) > range[axis] + EPS) return false;
    }
  }
  return true;
}

export function referenceScore(doc, colors, options = {}) {
  const { query, mode } = queryConfiguration(colors, options);
  const { points } = documentPalette(doc);
  const masses = [0, 0, 0, 0];
  for (const point of points) {
    let mask = 0;
    query.compiled.forEach((target, j) => { if (inside(point, target)) mask |= 1 << j; });
    masses[mask] += point.weight;
  }
  const cost = hardTransportCost(masses, query.targets.map((target) => target.amount), mode);
  return { cost, score: 1 - cost, masses, targets: query.targets, mode, boundary: "hard" };
}

// One fixed script source keeps varying colors/amounts in params and reuses compilation.
// At most 32 slots × 2 targets × 4 constraints; no data-size-dependent Painless loop.
export const painlessSource = `
boolean accepted(double[] point, List rules) {
  for (def rule : rules) {
    int kind = ((Number)rule[0]).intValue();
    if (kind == 0) {
      double x = point[3] - (double)rule[1];
      double y = point[4] - (double)rule[2];
      double z = point[5] - (double)rule[3];
      double radius = (double)rule[4] + 0.0000001;
      if (x*x + y*y + z*z > radius*radius) return false;
    } else if (kind == 1) {
      for (int axis = 0; axis < 3; axis++) {
        if (Math.abs(point[axis] - (double)rule[axis+1]) > (double)rule[axis+4] + 0.0000001) return false;
      }
    } else {
      double hueRange = (double)rule[4];
      if (hueRange < 1) {
        if (point[6] < 0) return false;
        double delta = Math.abs(point[6] - (double)rule[1]);
        if (2*Math.min(delta, 1-delta) > hueRange + 0.0000001) return false;
      }
      int saturation = kind == 2 ? 7 : 9;
      int brightness = kind == 2 ? 8 : 10;
      if (Math.abs(point[saturation] - (double)rule[2]) > (double)rule[5] + 0.0000001) return false;
      if (Math.abs(point[brightness] - (double)rule[3]) > (double)rule[6] + 0.0000001) return false;
    }
  }
  return true;
}
double[] masses = new double[4];
double[] point = new double[11];
int count = (int)doc['palette_size'].value;
if (count < 1 || count > 32) throw new IllegalArgumentException('Invalid palette size');
double total = 0;
for (int i = 0; i < count; i++) {
  def fields = params.slots[i];
  double weight = doc[fields[0]].value;
  if (weight <= 0) continue;
  if (params.rgb) for (int axis = 0; axis < 3; axis++) point[axis] = doc[fields[axis+1]].value;
  if (params.lab) for (int axis = 3; axis < 6; axis++) point[axis] = doc[fields[axis+1]].value;
  if (params.hue) {
    double r=point[0], g=point[1], b=point[2];
    double high=Math.max(r,Math.max(g,b)), low=Math.min(r,Math.min(g,b)), delta=high-low;
    double lightness=(high+low)/2;
    boolean neutral=delta <= 0.000001;
    double h=-1;
    if (!neutral) {
      double sector = high==r ? (g-b)/delta : high==g ? (b-r)/delta+2 : (r-g)/delta+4;
      h=((sector/6)%1+1)%1;
    }
    point[6]=h;
    point[7]=neutral ? 0 : delta/(1-Math.abs(2*lightness-1));
    point[8]=lightness;
    point[9]=neutral ? 0 : delta/high;
    point[10]=high;
  }
  int mask=0;
  for (int j=0; j<params.regions.size(); j++) if (accepted(point, params.regions[j])) mask |= 1 << j;
  masses[mask]+=weight;
  total+=weight;
}
if (total <= 0) throw new IllegalArgumentException('Palette has no visible area');
for (int j=0;j<4;j++) masses[j]/=total;
double a=params.a, b=params.b, requested=a+b;
double matched=Math.min(Math.min(requested,masses[1]+masses[2]+masses[3]),Math.min(a+masses[2]+masses[3],b+masses[1]+masses[3]));
double cost=params.minimum ? requested-matched : 1-Math.min(masses[0],Math.max(0,1-requested))-matched;
return Math.max(0,Math.min(1,cost));
`.trim();

function scriptParameters(query, mode) {
  const regions = query.compiled.map((target) => target.ranges.map((range) => {
    if (range.space === "oklab") return [0, ...target.lab, range.distance, 0, 0];
    if (range.space === "rgb") return [1, ...target.rgb, range.r, range.g, range.b];
    const coordinates = target[range.space];
    const axis = range.space === "hsl" ? "l" : "v";
    return [range.space === "hsl" ? 2 : 3, coordinates.h ?? -1, coordinates.s, coordinates[axis], range.h, range.s, range[axis]];
  }));
  return {
    slots: slotFields,
    regions,
    rgb: regions.some((rules) => rules.some((rule) => rule[0] !== 0)),
    lab: regions.some((rules) => rules.some((rule) => rule[0] === 0)),
    hue: regions.some((rules) => rules.some((rule) => rule[0] >= 2)),
    a: query.targets[0].amount,
    b: query.targets[1]?.amount ?? 0,
    minimum: mode === "minimum",
  };
}

export function dynamicQuery(colors, options = {}) {
  const { query, mode } = queryConfiguration(colors, options);
  const size = options.size ?? 20;
  if (!Number.isInteger(size) || size < 1 || size > 10000) throw new Error("Page size must be from 1 to 10000.");
  const filters = options.filters ?? [];
  if (!Array.isArray(filters)) throw new Error("filters must be an array of OpenSearch filter clauses.");
  const result = {
    size,
    track_total_hits: options.trackTotalHits ?? true,
    _source: options.source ?? false,
    query: filters.length ? { bool: { filter: filters } } : { match_all: {} },
    sort: [
      { _script: { type: "number", order: "asc", script: { lang: "painless", source: painlessSource, params: scriptParameters(query, mode) } } },
      { id: "asc" },
    ],
  };
  if (options.searchAfter !== undefined) result.search_after = options.searchAfter;
  if (options.pit !== undefined) result.pit = options.pit;
  return result;
}

const near = (a, b, tolerance = 2e-10) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);

export async function runProbe() {
  const root = new URL("./", import.meta.url);
  const index = "color-global-dynamic-probe";
  const request = async (path, body, method = body === undefined ? "GET" : "POST") => {
    const response = await fetch(ENDPOINT + path, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60000) });
    const data = await response.json();
    if (!response.ok) throw new Error(`${method} ${path}: ${JSON.stringify(data)}`);
    if (data.timed_out || data._shards?.failed) throw new Error(`Incomplete search: ${JSON.stringify(data)}`);
    return data;
  };
  const summary = { endpoint: ENDPOINT, index, mappingNumericFields: 224, maxRegions: MAX_REGIONS, boundary: "hard", closedFormCases: 0, documents: 0, nativeQueries: 0, maxNativeError: 0, maxOracleError: 0 };
  // Exhaustively compare every 5-unit membership distribution and demand split
  // against the earlier independent continuous min-cost transport implementation.
  for (let m0 = 0; m0 <= 5; m0++) for (let m1 = 0; m1 <= 5-m0; m1++) for (let m2 = 0; m2 <= 5-m0-m1; m2++) {
    const masses = [m0,m1,m2,5-m0-m1-m2].map((v) => v/5);
    for (let a = 0; a <= 5; a++) for (let b = 0; b <= 5-a; b++) for (const mode of ["target", "minimum"]) {
      const demand = [a/5,b/5,1-(a+b)/5];
      const costs = [0,1,2,3].map((mask) => [mask&1?0:1,mask&2?0:1,mode==="minimum"?0:mask?1:0]);
      const oracle = minCostTransport(masses,demand,costs).cost;
      near(hardTransportCost(masses,[a/5,b/5],mode),oracle);
      summary.closedFormCases++;
    }
  }
  const real = JSON.parse(await readFile(new URL("output/descriptors.json",root),"utf8"));
  const fixtures = JSON.parse(await readFile(new URL("ranges-fixtures.json",root),"utf8")).fixtures;
  const documents = [...real.map((doc) => ({id:doc.id,palette:doc.palette32,cohort:"real"})), ...fixtures.map((doc) => ({...doc,cohort:"fixture"}))];
  assert.equal(real.length,100);
  summary.documents = documents.length;
  const queries = [...RANGE_PRESETS.map((preset) => ({id:preset.id,colors:preset.colors})),
    {id:"hue-wrap",colors:[{color:"#FF0004",amount:.4,ranges:[{space:"hsl",h:.02,s:.1,l:.1}]}]},
    {id:"rgb-zero",colors:[{color:"#FF0000",amount:.7,ranges:[{space:"rgb",r:0,g:0,b:0}]}]},
    {id:"overlap",colors:[{color:"#FF0000",amount:.2,ranges:[{space:"rgb",r:.1,g:.1,b:.1}]},{color:"#FF0100",amount:.2,ranges:[{space:"rgb",r:.1,g:.1,b:.1}]}]},
    {id:"same-anchor",colors:[{color:"#000000",amount:.5,ranges:[{space:"hsl",h:1,s:.02,l:.1}]},{color:"#000000",amount:.5,ranges:[{space:"hsv",h:1,s:1,v:.25}]}]},
  ];
  assert.throws(() => dynamicQuery(queries[0].colors,{boundary:"graded"}));
  assert.throws(() => dynamicQuery(["#FF0000","#00FF00","#0000FF"].map((color) => ({color,amount:.2,ranges:[{space:"oklab",distance:.1}]}))));
  const exists = await fetch(`${ENDPOINT}/${index}`,{method:"HEAD"});
  if (exists.ok) await request(`/${index}`,undefined,"DELETE");
  await request(`/${index}`,{settings:{number_of_shards:3,number_of_replicas:0},mappings:{dynamic:"strict",properties:{...mappingProperties,cohort:{type:"keyword"}}}},"PUT");
  const payload = documents.map((doc) => `${JSON.stringify({index:{_index:index,_id:doc.id}})}\n${JSON.stringify({...toDynamicDocument(doc),cohort:doc.cohort})}\n`).join("");
  const bulkResponse = await fetch(`${ENDPOINT}/_bulk?refresh=true`,{method:"POST",headers:{"content-type":"application/x-ndjson"},body:payload});
  const bulk = await bulkResponse.json();
  if (!bulkResponse.ok || bulk.errors) throw new Error(`Bulk failed: ${JSON.stringify(bulk.items?.filter((item) => item.index.error).slice(0,2)??bulk)}`);
  for (const query of queries) for (const mode of ["target","minimum"]) {
    const expected = new Map(documents.map((doc) => {
      const reference = referenceScore(doc,query.colors,{mode});
      const oracle = scoreRangePalette(doc.palette,query.colors,{mode,boundary:"hard"});
      summary.maxOracleError = Math.max(summary.maxOracleError,Math.abs(reference.cost-oracle.cost));
      near(reference.cost,oracle.cost);
      return [doc.id,reference.cost];
    }));
    const result = await request(`/${index}/_search`,dynamicQuery(query.colors,{mode,size:documents.length}));
    assert.equal(result.hits.total.value,documents.length);
    assert.equal(result.hits.hits.length,documents.length);
    for (const hit of result.hits.hits) {
      const error=Math.abs(hit.sort[0]-expected.get(hit._id));
      summary.maxNativeError=Math.max(summary.maxNativeError,error);
      near(hit.sort[0],expected.get(hit._id));
    }
    for (let i=1;i<result.hits.hits.length;i++) {
      const before=result.hits.hits[i-1],after=result.hits.hits[i];
      assert.ok(before.sort[0]<=after.sort[0]);
      if(before.sort[0]===after.sort[0])assert.ok(before._id<after._id);
    }
    summary.nativeQueries++;
  }
  // Check that ordinary filters remain global and that PIT+search_after yields
  // every eligible document once across several shards, including tied costs.
  const query=queries[0],filters=[{term:{cohort:"real"}}];
  const pit=await request(`/${index}/_search/point_in_time?keep_alive=2m`,{});
  let searchAfter,seen=[];
  try {
    while(true) {
      const result=await request("/_search",dynamicQuery(query.colors,{size:13,filters,pit:{id:pit.pit_id,keep_alive:"2m"},searchAfter}));
      const hits=result.hits.hits;
      if(!hits.length)break;
      seen.push(...hits.map((hit)=>hit._id));
      searchAfter=hits.at(-1).sort;
    }
    assert.equal(seen.length,100);
    assert.equal(new Set(seen).size,100);
    summary.filteredPitPagination=100;
  } finally {
    await request("/_search/point_in_time",{pit_id:[pit.pit_id]},"DELETE");
  }
  summary.passed=true;
  await writeFile(new URL("global-dynamic-probe.json",root),JSON.stringify(summary,null,2)+"\n");
  process.stdout.write(JSON.stringify(summary,null,2)+"\n");
  return summary;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href && process.argv.includes("--probe")) await runProbe();
