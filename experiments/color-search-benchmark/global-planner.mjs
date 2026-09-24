// THROWAWAY PROTOTYPE: same-PIT strategy selection for exact global color ranking.
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { api } from "./global-common.mjs";
import { openPit, closePit } from "./global-bounded.mjs";
import { normalizeMultiQuery, multiQuery, boundedMultiSearch } from "./global-multi.mjs";

export const DIRECT_COUNT_LIMIT = 10_000;

export function requireCompleteSearch(body) {
  if (body.timed_out || body.terminated_early || body._shards?.failed > 0)
    throw new Error("Timed-out, terminated, or partial search cannot certify planner results.");
}

export function choosePlannerStrategy(filters, total) {
  if (!filters.length) return "adaptive";
  if (!total || !Number.isInteger(total.value) || total.value < 0 || !["eq", "gte"].includes(total.relation))
    throw new Error("Metadata count must report a nonnegative total and its relation.");
  return total.relation === "eq" && total.value <= DIRECT_COUNT_LIMIT ? "direct" : "adaptive";
}

/** Caller owns the returned PIT. Every page recounts metadata on that same snapshot. */
export async function plannedMultiSearch(index, input, options = {}) {
  if (typeof index !== "string" || !/^color-global-[a-z0-9_-]+$/.test(index))
    throw new Error("Only color-global- scratch indexes are allowed.");
  const started = performance.now();
  const colors = normalizeMultiQuery(input), mode = options.mode ?? "target";
  const filters = options.filters ?? options.filter ?? [];
  if (!Array.isArray(filters)) throw new Error("Metadata filters must be an array.");
  if (options.filters !== undefined && options.filter !== undefined && JSON.stringify(options.filters) !== JSON.stringify(options.filter))
    throw new Error("Conflicting filter and filters options.");
  if (options.from !== undefined) throw new Error("Use search_after for planner pagination.");
  if (options.maxError !== undefined) throw new Error("The planner ranks all matches; use threshold only as an adaptive starting hint.");
  if (options.scriptVariant !== undefined && options.scriptVariant !== "typed") throw new Error("This planner uses the typed script variant.");
  if (options.threshold !== undefined && (!Number.isFinite(options.threshold) || options.threshold < 0 || options.threshold > 1)) throw new Error("Threshold must be between 0 and 1.");
  const size = options.size ?? 20;
  const suppliedPit = typeof options.pit === "string" ? options.pit : options.pit?.id;
  if (options.pit !== undefined && (typeof suppliedPit !== "string" || !suppliedPit)) throw new Error("A supplied PIT needs a nonempty id.");
  const cursor = options.search_after;
  if (cursor !== undefined && (!Array.isArray(cursor) || cursor.length < 2 || !Number.isFinite(cursor[0]) || cursor[0] < 0 || cursor[0] > 1 || typeof cursor[1] !== "string"))
    throw new Error("search_after must be a returned score/id cursor.");
  if (cursor && !suppliedPit) throw new Error("Pagination requires the previous PIT.");
  const keepAlive = typeof options.pit === "object" ? options.pit.keep_alive ?? "2m" : options.keep_alive ?? "2m";
  const queryFingerprint = createHash("sha256").update(JSON.stringify({ planner: "metadata-count-v1", index, colors, mode, filters, forceGeneral: options.forceGeneral ?? false, scriptVariant: "typed" })).digest("hex");
  if (options.queryFingerprint && options.queryFingerprint !== queryFingerprint) throw new Error("Cursor belongs to a different planner query or metadata filter.");
  // Validate all scoring options before opening a PIT or sending the count request.
  const shared = { ...options, size, mode, filters, filter: filters, scriptVariant: "typed" };
  delete shared.queryFingerprint;
  const directBody = multiQuery(colors, shared);
  let pitId = suppliedPit, created = false, eligibleTotal = null;
  const timing = { pitMs: 0, countMs: 0, finalMs: 0, totalMs: 0, requests: 0 };
  let strategy = "adaptive", hits, exhausted, threshold, delegatedDiagnostics, profile;
  try {
    if (!pitId) {
      const opened = await openPit(index, keepAlive);
      pitId = opened.pitId; created = true;
      timing.pitMs = opened.wallMs; timing.requests++;
    }
    if (filters.length) {
      const counted = await api("/_search?allow_partial_search_results=false", {
        size: 0,
        _source: false,
        track_total_hits: DIRECT_COUNT_LIMIT + 1,
        query: { bool: { filter: filters } },
        pit: { id: pitId, keep_alive: keepAlive },
        timeout: options.timeout ?? "15s",
      });
      timing.countMs += counted.wallMs; timing.requests++;
      requireCompleteSearch(counted.body);
      pitId = counted.body.pit_id ?? pitId;
      eligibleTotal = counted.body.hits.total;
      strategy = choosePlannerStrategy(filters, eligibleTotal);
    }
    if (strategy === "direct") {
      if (eligibleTotal.value === 0) { hits = []; exhausted = true; }
      else {
        directBody.pit = { id: pitId, keep_alive: keepAlive };
        const response = await api("/_search?allow_partial_search_results=false", directBody);
        timing.finalMs += response.wallMs; timing.requests++;
        requireCompleteSearch(response.body);
        pitId = response.body.pit_id ?? pitId;
        hits = response.body.hits.hits;
        exhausted = hits.length < size;
        profile = response.body.profile;
      }
    } else {
      const result = await boundedMultiSearch(index, colors, { ...shared, pit: { id: pitId, keep_alive: keepAlive } });
      pitId = result.pitId; hits = result.hits; exhausted = result.exhausted; threshold = result.threshold;
      timing.finalMs += result.timing.finalMs; timing.requests += result.timing.requests;
      delegatedDiagnostics = result.diagnostics; profile = result.profile;
    }
    timing.totalMs = performance.now() - started;
    return {
      hits, pitId, strategy, eligibleTotal, exhausted, queryFingerprint, timing,
      ...(threshold === undefined ? {} : { threshold }),
      diagnostics: { directCountLimit: DIRECT_COUNT_LIMIT, metadataCountRequested: filters.length > 0, adaptive: delegatedDiagnostics ?? null },
      next: exhausted ? null : { pit: pitId, pitId, search_after: hits.at(-1).sort, queryFingerprint, ...(threshold === undefined ? {} : { threshold }) },
      ...(profile ? { profile } : {}),
    };
  } catch (error) {
    if (created && pitId) await closePit(pitId).catch(() => {});
    throw error;
  }
}
