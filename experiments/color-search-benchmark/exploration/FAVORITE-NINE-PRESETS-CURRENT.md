# Nine-preset million-record storage and performance comparison

Started 2026-09-23 after the completed favorite-only v11 campaign.

**Full build cannot proceed with current storage.** User confirmed there is no
additional disk or mounted path. Scale service remains stopped; no indexing or
performance run from this round has started. Preserve the prepared harness for
future use; do not launch a partial build and call it the requested measurement.

## User request

Measure actual gigabytes for a fully populated one-million-record index containing
all nine quality-influence/cutoff-weight combinations. Compare performance with
the completed favorite-only index; do not present a partial projection as a full
measurement. Keep existing visual comparisons available.

## Scope

- Same 256-bin shade-aware strict-hue scoring, numeric float utilities with points
  and doc values, disabled stored source, one primary, no replicas.
- Quality influence 0 / 0.5 / 1 crossed with cutoff weighting 0 / 1 / 3.
- 55,242 utilities per document, versus 6,138 in the favorite-only index.
- Same deterministic one-million synthetic records derived from 523 real images;
  not one million independently collected wallpapers.
- Numeric and ordinary pooled bounded execution. OpenSearch performs ranking.
- Separate identical-favorite-query comparison from queries switching presets.
- Preserve previous artifacts, UUIDs and the original favorite snapshot.

## Plan / status

1. **In progress: storage feasibility.** Existing filesystem has about 235 GB
   available. A naive nine-times prior size is about 504 GB, an estimate only;
   merge/recovery headroom is additional. Do not launch a potentially disk-filling
   million-record build without sufficient capacity and a stopping guard.
2. **Preparation implemented.** Mixed-preset workload support and disk/STOP guards
   have passed targeted offline checks. Three configs prepared externally:
   baseline favorite (2 candidates), all-nine presets (18), and all-nine favorite
   (2). The all-nine primary dry run passed: 18 candidates, 72 query cases, no
   service requests. Existing favorite-only workloads remain unchanged.
3. Build into a fresh external artifact directory and a fresh index after the
   storage constraint is resolved. Record all acknowledgement/count/field checks.
4. Audit sampled stored values for all nine presets and same-favorite score parity.
5. Serial matched load tests with fixed CPU/RAM, settled merges, explicit open-index
   inventory, resource observer, failures and per-preset coverage retained.
6. Independently review results and report measured storage and latency ratios.

## Current environment

- Prior external evidence:
  `/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/favorite-optimization/2026-09-23/`.
- New round evidence:
  `/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/favorite-nine-presets/2026-09-23/`.
- At 21:51 UTC, available disk was 235,362,131,968 bytes. User subsequently
  confirmed no additional disk is available. This is a resource constraint,
  not authorization to delete existing data.
- No build or load test from this round has started. A 100k pilot is not a substitute
  for the requested 1M result. The prior favorite-only 100k index was 13.045 GB,
  so even a nine-preset pilot needs conservative transient-space planning.
- Prior baseline: `color-exploration-favorite-points-full-1m-v1`, UUID
  `LHjoEvSiR8KNe5WZv_a7iA`, 1,000,000 docs; measured primary store
  56,048,738,808 bytes at build completion, 66 segments.
- Scale OpenSearch 19217 is stopped; 8 CPU / 4 GiB heap / 12 GiB memory limits.
- Keep real OpenSearch 19216 and UIs 8225/8227/8228 available.
- Other worktrees have active services; do not stop or remove their data.

## Delegation

- Root: storage decision, persistent plan/logs, Make integration, live operations.
- `control_support_check`: read-only capacity/index build and completeness review.
- `speedup_comparison`: mixed-preset workload module/arrival support/tests; no live load.
- `cache_priority_check`: independent experimental design and resource/audit review.

## Measurement caveats

- All-preset wide bank is 73,656 queries / 55,242 utility keys. A 600-second run
  at 16 or 64 requests/s cannot traverse the entire bank. Report actual coverage;
  design a longer traversal if claiming all-field coverage.
- Same-host unrelated activity can influence latency. Historical baseline alone
  is insufficient for attributing a difference to the extra presets.
- Primary-store bytes exclude replicas and are not RAM-cache requirements.
- Do not modify or restart the completed eight-phase campaign.

Detailed design and audit checklist: [comparison protocol](FAVORITE-NINE-PRESETS-PROTOCOL.md).

## Preparation validation

- Disk/STOP guard: 16 index tests, 4 numeric receipt-audit regressions and 10 bulk
  scheduler tests passed. It checks the chosen filesystem before creation and
  every two seconds while admitting work, then drains accepted requests and
  records interruptions. It does not reserve space from concurrent writers or
  merges; sufficient capacity is still required before starting.
- Mixed presets: 7 workload, 21 arrival and 15 independent-audit tests passed.
  Fixed/varied/wide interleave all nine presets, require matching successful C1
  evidence, and record actual per-preset coverage. Legacy workloads retained.
- Independent read review found no blocking issues in guard, runner or auditor.
- Saved fixed-arrival evidence re-audited with the extended auditor: 16 profiles,
  27,856 raw rows, all three failed profiles retained, zero audit discrepancies.
  Output: `harness-compat-fixed-audit-v1.json` in the new external root.
- No live services started, no new indexes built, no benchmark latency measured.
- Scope correction is also saved as `storage-scope-correction-v1.json` in the new
  external evidence root. Original size claims must always include record count.

## Original approximately 20 GB claim: scope correction

User asked whether the original favorite's approximately 20 GB at 1,024 bins was
inaccurate compared with the new nine-preset estimate. The saved measurement is
real, but it covers **100,000 records**, not one million:

| Representation | Records | Primary-store bytes | Status |
| --- | ---: | ---: | --- |
| Original full 256-bin measurements, source enabled | 100,000 | 4,786,014,183 | Measured |
| Original full 1,024-bin measurements, source enabled | 100,000 | 19,139,629,133 | Measured |
| Original query-field projection, source disabled | 1,000,000 | 1,249,705,319 | Measured; only 70 measurement fields |
| Optimized 256-bin favorite preset, source disabled | 1,000,000 | 56,048,738,808 | Measured full preset |
| Optimized 256-bin nine presets, source disabled | 1,000,000 | 504,438,649,272 | Naive 9x estimate ONLY; not built |

Original raw receipt independently checked:
`/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/favorite-performance/2026-09-22/maintenance/maintenance.json`.
Its 2026-09-23 00:23:56 observation has 30 segments for full1024 and 21 for full256.
See [original performance report](FAVORITE-PERFORMANCE.md#full-schema-pilots-and-settled-storage).

Original 1,024-bin representation stores 1,024 bins x 5 cutoff layers x 2 values
(coverage/quality), plus 46 named measurements and 6 metadata fields: 10,292
fields. Sliders and percentages are calculated at query time without duplicating
the indexed measurements. The optimized representation stores (256 bins + 23
named targets) x 22 profiles (vibe + 21 requested percentages) = 6,138 precomputed
scores for each preset, or 55,242 for nine. These are different storage designs,
and the larger optimized index buys faster queries by storing more calculated
answers. Neither 20 GB as a million-record maximum nor 504 GB as a measured
nine-preset result is supported. Do not silently extrapolate compression/merge
behavior from 100k to 1M or compare source-enabled and source-disabled schemas as
if their storage costs were identical.

## User discussion: fewer percentages and one quality-preference control

User proposes 10% percentage steps and linking cutoff weighting with quality
influence into one slider with three or five choices. The subsequent requested
small-corpus prototype is now indexed separately; see
[linked-slider implementation and evidence](LINKED-STRICTNESS-PROTOTYPE.md).
The million-record nine-preset campaign remains blocked on disk capacity, and
the saved favorite and existing indexes remain unchanged.

- Preserve the exact favorite pair: linear quality influence 0.5, cutoff weight 1.
- A three-choice starting path is relaxed (0,0), favorite (0.5,1), strict (1,3),
  where pairs are (quality influence, cutoff weighting).
- Five choices could add intermediate pairs. One path using existing presets is
  (0,0), (0.5,0), (0.5,1), (1,1), (1,3); continuous intermediate parameter values
  could instead be evaluated if perceptually smoother. No final path selected.
- Controls are not mathematically interchangeable: influence applies a quality
  penalty within a layer; weighting emphasizes stricter layers and their covered
  area. Percentage-query behavior and darker-red preferences require evaluation.
- Named abstract features have one component, so cutoff weighting has no effect
  on them. A five-choice existing-preset path repeats some named-feature scores.
- With 10% steps: 11 percentage profiles + vibe = 12. Three linked presets give
  36 fields/bin, 10,044 across 279 targets (81.8% fewer than current 55,242).
  Five give 60 fields/bin, 16,740 total (69.7% fewer). These are exact field counts;
  disk savings, full-index fit and performance have not been measured.
- Query execution can still select one precomputed field per target and let
  OpenSearch rank globally. Fewer controls change which presets are offered,
  rather than requiring application-side reranking.
