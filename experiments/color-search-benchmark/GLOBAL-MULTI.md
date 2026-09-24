# One to five color proportions with global OpenSearch ranking

This throwaway prototype supports exact requested amounts for up to five of the 18 indexed color families. It counts original source pixels, preserves overlaps between families, and ranks all eligible wallpapers inside OpenSearch. Adaptive indexed bounds can reduce scoring work without restricting the result to an approximate candidate list.

For example:

- **40% green, remainder unspecified:** 40% actual green is a perfect amount match; 80% green has 40% error.
- **50% green / 50% red:** the requested areas must be supplied together.
- **20% each red / orange / yellow / green / blue:** five disjoint matching 20% areas give zero error. A single shared 20% area that matches all five families, with 80% unrelated area, gives 80% error. The same area cannot fill five requests.

The default is `mode: 'target'`. Optional `mode: 'minimum'` only charges missing requested area. The score is `float32(1 − error)`, ordered descending, then by document ID ascending. Scores measure the defined amount objective; they are not human aesthetic ratings or calibrated perceptual similarities.

## Run

```sh
make color-global-multi-prepare
make color-global-multi-probe
```

The probe uses the dedicated OpenSearch 2.11.0 service at `127.0.0.1:19216` and recreates only `color-global-multi-probe`. Corpus preparation reads the existing checksum-pinned source files and writes a separate `global-multi-data.json`; it does not modify the earlier resized-pixel corpus.

## Source accuracy and representation

The 100 real wallpapers use **original-image RGBA pixels with deterministic stratified jitter sampling**, targeting 65,536 samples each. No resize or interpolation occurs. The seed is derived from sampler version, original image SHA-256, target sample count, and replicate zero. Actual sample counts are 65,373–65,520 because the sampler chooses a rectangular grid. Alpha bytes supply exact integer weights; fully transparent pixels contribute no area.

This sampling differs from the earlier 256-pixel-resize experiments. Comparisons with those experiments change both the color representation and the sampling method. See [GLOBAL-SAMPLING.md](GLOBAL-SAMPLING.md) for the independent sampling accuracy measurements; do not attribute the entire improvement to the joint scoring algorithm.

Every sampled pixel gets an 18-bit membership mask for the frozen family bank. The extractor accumulates alpha counts by mask, including pixels matching no family. The result preserves every overlap among the indexed families without reducing the image to palette centroids.

| Real-corpus measurement | Result |
|---|---:|
| Wallpapers | 100 |
| Membership atoms per wallpaper | 5–109 |
| Median atoms | 47 |
| Mean atoms | 48.57 |
| Coverage values compared with cached original-pixel sampler | 1,800 |
| Maximum coverage difference | 2.50×10⁻¹⁶ |
| Pair unions compared with the same sampler | 15,300 |
| Maximum pair-union difference | 4.44×10⁻¹⁶ |

The same 20 analytic fixtures use their known weighted colors, quantized to one billion count units by deterministic largest remainder. Synthetic scale mixtures use the same three-basis selections and weights as `nativeMixture`, then merge and quantize membership atoms to that total. Mixtures are synthetic stress data, not additional independent photographs.

### Packed numeric fields

Each membership atom is stored as one doc-value `long`:

```text
packed_atom = membership_mask × 2³² + alpha_count
```

The count must be positive and the complete histogram total must be below 2³². With 18 family bits, packed values are below 2⁵⁰ and remain exactly representable by JavaScript numbers. Packing is necessary because numeric doc-value arrays sort their values; independent mask and count arrays would lose their association.

`packed_atoms` and `atom_total` are not indexed for filtering. The 18 singleton coverage fields and 153 pair-union fields are indexed doubles. Those bound fields are derived from the **same integer atoms** used by the scorer. The bank's bit order is stored as `familyBitOrder` in the dataset and must remain unchanged for an index's lifetime.

## Exact joint calculation

For a request with total amount `A`, let `U(S)` be the wallpaper area belonging to at least one requested family in subset `S`. Exclusive matching is governed by the largest subset shortage:

```text
D = max(0, max over subsets S of [requestedAmount(S) − U(S)])

minimum error = D
target error  = D + max(0, U(all requested families) − A)
```

The script projects global atoms onto the selected one to five family bits. At five families this creates 32 local bins. A subset-sum transform gives all needed union areas. Cost per scored document is `O(atomCount × selectedFamilies + selectedFamilies × 2^selectedFamilies)`.

The one/two-family path uses the existing constant-size union formula by default. `forceGeneral: true` exercises the histogram calculation for those cases too. The formulas, flow-network proof, and pair-statistic counterexample are recorded in [GLOBAL-MULTI-DESIGN.md](GLOBAL-MULTI-DESIGN.md).

## Indexed bounds and adaptive global search

For joint error at most `T`, every subset must satisfy `U(S) ≥ requestedAmount(S) − T`. The query applies the indexed singleton and pair instances of this necessary condition before scripting. In target mode it also applies the safe upper bound `U(S) ≤ A + T` to those fields. For three or more requests, this upper bound uses **total requested amount**, not the selected pair's amount.

`boundedMultiSearch` starts at an error bound of 0.01 by default. It globally scores all documents surviving the indexed bounds. If a page is short, it doubles the bound until the page is full or the bound reaches one. An explicitly supplied zero bound advances first to 10⁻⁶. No coarse token seed or application reranking is needed.

A full page also requires the bound to include every exact error that could round to the last hit's float32 score. The wrapper calculates that entire score bin and expands again if necessary. This preserves ID ordering within ties. The same PIT snapshot and metadata filters are used for every attempt and subsequent page. A short page is declared exhausted only at bound one, so omitted matches cannot hide behind a narrow bound. Timeouts or failed shards reject the result instead of certifying it.

Worst case, the bounds are broad and the wrapper performs several rounds before exhaustive scoring. Deep pagination and restrictive metadata filters can require wider bounds. Small-scale probe execution does not establish million-document latency; the parent benchmark measures that separately.

## API

```js
import {
  MULTI_PROPERTIES,
  toMultiDocument,
  multiMixture,
  multiQuery,
  multiReference,
  boundedMultiSearch,
} from './global-multi.mjs';

const colors = [
  { family: 'red', amount: 0.2 },
  { family: 'orange', amount: 0.2 },
  { family: 'yellow', amount: 0.2 },
  { family: 'green', amount: 0.2 },
  { family: 'blue', amount: 0.2 },
];

const body = multiQuery(colors, {
  filters: [{ term: { cohort: 'real' } }],
  size: 20,
  mode: 'target',
});

const page = await boundedMultiSearch('color-global-multi-real-v1', colors, {
  filter: [{ term: { cohort: 'real' } }],
  size: 20,
  threshold: 0.01,
});
// Continue with the same query/filter/size and ...page.next.
// Close page.pitId with closePit from global-bounded.mjs when finished.
```

Amounts are absolute image fractions and must sum to at most one. Duplicate family entries merge; explicit zero amounts are preserved. Arbitrary new color definitions, graded membership, and center-quality tie-breaking require a different model or reindexing and are not supported here.

`multiQuery` returns a standard OpenSearch search body with `_source: false`, score/ID sort, and a 15-second timeout by default. It supports `filters`/`filter`, `size`, `mode`, `pit`, `search_after`, `maxError`, `profile`, `track_total_hits`, and `_source`. Callers should use `allow_partial_search_results=false` and reject incomplete responses.

`boundedMultiSearch` does that response checking itself. It returns `{hits, pitId, threshold, queryFingerprint, exhausted, next, diagnostics, timing}`. The wrapper closes a newly created PIT on failure; the caller owns it after a successful response. It restricts index names to the experiment's `color-global-` namespace. Bounded hit counts are not the original eligible total.

The dataset contains `.wallpapers` and `.fixtures`. Each document preserves display metadata and adds `atoms: [{mask,count}]`, `total`, `features`, `unions`, `cohort`, `partition`, and `sampling`. `toMultiDocument` emits only the declared mapped fields; the loader adds common metadata explicitly. `multiReference` accepts either raw atoms or the mapped packed fields.

## Verification

[global-multi-probe.json](global-multi-probe.json) records the successful real-server probe on **165 documents across three shards**:

- 1,600 comparisons against the independent generic min-cost transport solver, across one through five families and both modes; maximum difference 4.86×10⁻¹⁶.
- 240 complete OpenSearch rankings covering one/two/three/five-family requests, including a partial three-family request totaling 60%, both modes, five error-bound settings, filtered/unfiltered searches, and both original/typed script variants; all IDs and float32 scores matched the JavaScript oracle.
- Two optimized one/two-family query paths matched the general reference ranking.
- Both modes paginated all 165 documents over 13 pages, starting from bound zero, without omissions or duplicates.
- An inserted new best match stayed out of an existing PIT and appeared in a new snapshot.
- Exact rainbow and overlapping-rainbow counterexamples behaved as described above.
- Maximum-width packing round-trip, raw/mapped scoring equivalence, deterministic synthetic mixtures, and exact integer count totals passed.
- An adversarial partial three-family query crossed the float32 tie boundary in both script variants. Starting at exact error 0.2 excluded an earlier-ID document with slightly worse exact error but the same float32 score. Certification expanded to 0.20000001808139342, then same-PIT pages correctly returned `a-tied-worse`, `z-better`, and the lower-scoring `000-next-bin`.

The earlier independent design exploration contains another 7,636 transport checks in [global-multi-proof.json](global-multi-proof.json). These checks establish the stated hard-membership allocation objective and global result correctness. They do not establish subjective color-family quality; the fixed region definitions and original-image sampling remain separate sources of approximation.
