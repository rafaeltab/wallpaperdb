# Color ranges, center preference, and scale: findings

## What the prototype demonstrates

**Per-portion color ranges work.** Each requested area can use an OKLab radius or separate RGB, HSV, or HSL limits. Constraints in two spaces can be combined with AND. The editor includes “70% near red / 30% near black,” dark grayscale, any dark color, RGB boxes, and combined constraints.

**The requested dropoff works without changing the area count.** Default ranking first minimizes composition error, then prefers central shades among equal composition matches. Preference is 100% at the center and 50% at the boundary. A 70% patch near the edge remains 70% accepted image area. Unrestricted coordinates do not affect preference, so any-dark queries do not invent a preference for gray over equally dark blue.

Open **[the range editor](ranges.html)**. On the current tailnet server: **http://zerotwo:8220/ranges.html**. [Run instructions and units](RANGES-README.md) explain the controls; “20% distance” needs a defined color space and scale rather than a universal visual percentage.

## Dark grayscale and any dark color are separate choices

| Intent | Example constraint around black |
|---|---|
| Dark grayscale | HSL: any hue, saturation 0–2%, lightness 0–10% |
| Dark colors, including saturated ones | HSV: any hue, any saturation, value 0–25% |

Black has no meaningful hue. The editor requires an unrestricted hue for achromatic anchors. Hue differences wrap around the color wheel. RGB and HSL/HSV limits use absolute channel percentage points; hue is displayed in degrees.

The same image area cannot fill two requested portions. For overlapping regions, available area can count toward several possible regions, but allocated area counts once. A zero-error result means a feasible partition into the requested portions, not equality of independently overlapping region totals.

## Verification

- **28 diagnostic groups pass**, including boundary inclusion, hue wrapping, zero radii, achromatic handling, AND constraints, exact/minimum proportions, overlapping allocations, and graded center preference.
- The solver agrees with an independent exhaustive oracle on **300 seeded cases** and a closed-form reference on **500 continuous cases**. Maximum primary-cost discrepancy: `2.22e-16`; secondary-cost discrepancy: `1.11e-16`.
- **20 separate synthetic fixtures** establish known compositions. The graded comparison ranks exact red/black above other accepted red shades with the same 70/30 composition.
- Browser checks cover all controls, real/synthetic datasets, invalid queries, shareable URLs, mobile layouts, and an accessibility smoke check. See [browser evidence](RANGES-BROWSER-CHECK.md).

An audit caught a real numerical bug: approximate OKLab→RGB conversion could give pure white spurious HSL saturation. Neutral handling was corrected, and its regression passes.

## Results on the 100 real wallpapers

Seven editor presets were checked against an independently sampled pixel reference using the same requested mathematical regions. A second reference classifies the exact pixels used to build the palettes, separating clustering error from sampling error. Neither reference supplies human relevance judgments.

| Measurement | Result |
|---|---:|
| Mean absolute region-area difference, 32-color palette vs larger pixel sample | **0.77 percentage points** |
| Mean difference from the exact pixels used to build the 32-color palette | **0.63 percentage points** |
| Mean region-area difference, 128-color palette vs larger pixel sample | **0.57 percentage points** |
| Average top-ten overlap, graded32 vs graded128 | **82.9%** |
| Local graded scoring and sorting of 100 prepared wallpapers | **about 1.4–7.9 ms**, depending on query |
| Local flat-membership scoring of the same 100 wallpapers | **about 1.0–2.0 ms** |

The center preference adds modest absolute cost for a bounded reranker in these tests. Ratios vary by query because flat membership can combine identical membership patterns, while graded scoring must retain differing color preferences. Timings exclude extraction, retrieval, network, and browser work. They do not establish throughput or latency for a production collection.

Some useful dark-color matches were found: the 70%-dark-gray preset's first result estimates **70.05%**, versus **70.55%** in the larger source sample. The 70%-any-dark preset finds approximately **69.64%**, versus **69.00%** in that sample. Several other mixtures still lack close matches in this small corpus.

### A significant failure hidden by the average

For the narrow “all grayscale, saturation ≤2%” query, wallpaper-088 has:

| Representation | Area accepted by the grayscale region |
|---|---:|
| 32-color palette | 0% |
| 128-color palette | 0% |
| Exact approximately 10,000 pixels used to build those palettes | 35.00% |
| Independently sampled pixels, up to 256×256 | 37.64% |

**The compact palette can lose a thin color region.** Most of this example's error comes from clustering, not from the difference between pixel samples. Simply raising the palette from 32 to 128 does not fix it. This is a descriptor limitation, not a solver failure or an effect of graded preference.

Consequently, the earlier point-color result that 32 and 128 colors produced almost identical rankings must not be carried over to arbitrary ranges. Tight channel limits need a representation that preserves boundary uncertainty, or verification against a retained pixel sample. The UI labels areas as estimates and links this evaluation.

The default also makes a deliberate tradeoff: even a small improvement in area error outranks a stronger center preference. Palette approximation can therefore affect ordering before shade preference is considered. A future amount-tolerance control could group nearly equal area fits before considering shade, but it has not been implemented or evaluated here.

See [full rankings and evaluation](RANGES-EVALUATION.md) for each query and its outliers.

## Can this scale to one million or 100 million?

**A bounded reranking stage is a credible design; efficient end-to-end retrieval is unproven.** The proposed pipeline is:

1. OpenSearch retrieves a union of plausible candidates using metadata, coarse composition descriptors, and indexed summaries for common color families.
2. The application checks the requested ranges and ranks a bounded candidate set using area error and center preference.
3. Tight or uncertain boundaries on the best candidates are verified with finer source samples.

Finding the right candidate set is the hard part. A single cosine/L2 query cannot generally express arbitrary ranges, unconstrained hue, exact amounts, overlapping portions, and free remainder. A fast reranker cannot recover good matches that retrieval omits. Candidate recall needs measurement against exhaustive range rankings before production adoption.

For storage perspective, a packed 32-entry palette with three float32 coordinates and a float32 weight takes **512 bytes per image**: **0.512 GB at 1M** or **51.2 GB at 100M**, before IDs, indexes, serialization, replicas, or caches. Retrieval vectors and graph indexes add substantial storage and memory. Source samples for narrow-range verification add further cost. The actual JSON prototype is not a packed production representation.

One million is a reasonable next benchmark size. At 100 million, distributed retrieval, candidate budgets, cache locality, concurrency, recall, and boundary verification need explicit performance and cost targets. No claim of interactive production latency at either size is supported by this 100-image experiment.

[RANGES-SCALING.md](RANGES-SCALING.md) records the OpenSearch 2.11 capabilities, source citations, storage calculations, proposed architecture, and validation plan. In particular, it distinguishes existing 2.11 features from later vector search features.

## Reproduce

```sh
make color-ranges-diagnose color-ranges-evaluate
COLOR_PROPORTIONS_HOST="$(tailscale ip -4)" make color-ranges-serve
```

All new work is isolated in this experiment. Production services, mappings, and event contracts remain unchanged. Source hashes, numeric results, mathematical design, browser checks, and the [work log](RANGES-WORKLOG.md) preserve the evidence for later sessions.
