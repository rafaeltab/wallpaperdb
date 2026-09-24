// THROWAWAY PROTOTYPE: source-only optimization of the existing exact atom scorer.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { api, readJson, saveJson } from "./global-common.mjs";
import { MULTI_SCRIPT, multiQuery, multiReference } from "./global-multi.mjs";
import { FAST_MULTI_SCRIPT } from "./global-multi-fast-source.mjs";

export { FAST_MULTI_SCRIPT } from "./global-multi-fast-source.mjs";

/** Replace only the general scorer. One/two-family specialized queries stay intact. */
export function withFastMultiScript(body) {
  const script = body.query?.script_score?.script;
  if (script?.source !== MULTI_SCRIPT) return body;
  assert.ok(FAST_MULTI_SCRIPT.length > 0, "Optimized script must be implemented.");
  return { ...body, query: { ...body.query, script_score: { ...body.query.script_score, script: { ...script, source: FAST_MULTI_SCRIPT } } } };
}

export const FAST_PROBE_QUERIES = [
  { id: "green40", colors: [{ family: "green", amount: .4 }] },
  { id: "red70dark30", colors: [{ family: "red", amount: .7 }, { family: "dark", amount: .3 }] },
  { id: "grayscale40", colors: [{ family: "grayscale", amount: .4 }] },
  { id: "warm30_30_40", colors: [{ family: "red", amount: .3 }, { family: "orange", amount: .3 }, { family: "yellow", amount: .4 }] },
  { id: "dark40blue30navy30", colors: [{ family: "dark", amount: .4 }, { family: "blue", amount: .3 }, { family: "navy", amount: .3 }] },
  { id: "rainbow20", colors: ["red", "orange", "yellow", "green", "blue"].map(family => ({ family, amount: .2 })) },
  { id: "partial_three", colors: [{ family: "dark", amount: .2 }, { family: "blue", amount: .1 }, { family: "navy", amount: .15 }] },
  { id: "partial_four", colors: ["red", "orange", "yellow", "green"].map(family => ({ family, amount: .1 })) },
  { id: "partial_five", colors: ["red", "orange", "yellow", "green", "blue"].map(family => ({ family, amount: .1 })) },
  { id: "zero_five", colors: ["dark", "blue", "navy", "gray", "grayscale"].map(family => ({ family, amount: 0 })) },
];

async function search(index, body) {
  assert.match(index, /^color-global-[a-z0-9_-]+$/);
  const result = await api(`/${index}/_search?allow_partial_search_results=false`, body);
  assert.equal(result.body.timed_out, false, "Timed-out searches are invalid comparisons.");
  assert.equal(result.body._shards.failed, 0, "Partial searches are invalid comparisons.");
  return { hits: result.body.hits.hits, took: result.body.took, wallMs: result.wallMs };
}

const signature = hits => hits.map(hit => [hit._id, Math.fround(hit._score)]);
const sourceHash = source => createHash("sha256").update(source).digest("hex");

export async function runFastProbe() {
  assert.ok(FAST_MULTI_SCRIPT.length > 0, "Optimized script must be implemented.");
  const data = await readJson("global-multi-data.json");
  const indexing = await readJson("global-multi-indexing.json");
  assert.equal(data.cacheKey, indexing.dataCacheKey);
  assert.equal(data.wallpapers.length, 100);
  const report = { generatedAt: new Date().toISOString(), index: "color-global-multi-real-v1", dataCacheKey: data.cacheKey, indexFingerprint: indexing.fingerprint, originalSourceHash: sourceHash(MULTI_SCRIPT), fastSourceHash: sourceHash(FAST_MULTI_SCRIPT), checks: [] };
  for (const query of FAST_PROBE_QUERIES) for (const mode of ["target", "minimum"]) for (const maxError of [undefined, .25, .8]) {
    const options = { size: 100, filters: [{ term: { cohort: "real" } }], forceGeneral: true, mode, maxError, timeout: "30s" };
    const body = multiQuery(query.colors, options);
    const original = await search(report.index, body);
    const fast = await search(report.index, withFastMultiScript(body));
    assert.deepEqual(signature(fast.hits), signature(original.hits), `${query.id}/${mode}/${maxError}: original ordering and scores`);
    const expected = data.wallpapers.map(doc => ({ id: doc.id, ...multiReference(doc, query.colors, options) }))
      .filter(doc => doc.eligible).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    assert.deepEqual(signature(fast.hits), expected.map(doc => [doc.id, doc.score]), `${query.id}/${mode}/${maxError}: JS oracle`);
    report.checks.push({ query: query.id, regions: query.colors.length, mode, maxError: maxError ?? null, hits: fast.hits.length, passed: true });
  }
  await saveJson("global-multi-fast-probe.json", report);
  console.log(`Fast multi script: ${report.checks.length} native original/optimized/oracle comparisons passed, including all 100 original wallpapers.`);
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--probe")) await runFastProbe();
  else throw new Error("Choose --probe.");
}
