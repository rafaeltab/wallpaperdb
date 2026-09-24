# What the loop can prototype, and what needs expanding

Recorded **2026-09-20**, answering the user's question about using the loop for all color-filtering methods. This is a capability assessment, not authorization inferred for implementing every extension, a new shortlist, or a production-method decision.

## Current capability

The adapter interface can host different histograms, palettes, named-color/vibe features, transport objectives, spatial features, learned inference and combinations. Each module owns its preparation and complete search operation and returns ranked IDs with comparable higher-is-better scores. Methods do not need identical internal representations or score scales. New algorithms still require their own adapters; the registered initial controls are only the existing HSV cosine/raw-L2/unit-sum-L2 formulas.

Configuration sweeps, preserved runs, human-preference metrics, timing and reports are reusable. A custom adapter can combine components or make several OpenSearch requests, with the full awaited search path timed. There is no ready-made declarative component mixer, training pipeline or autonomous experiment-generating optimizer. The earlier statement that combinations are supported refers to this programmable adapter boundary.

We can start prototyping additional families using this foundation. Trustworthy comparisons across all requested controls and production-scale retrieval need the following extensions.

## Shared extensions

| Area | Existing limitation | Useful extension |
| --- | --- | --- |
| Query meaning | Normalization accepts current query shapes and rejects unknown fields. Vibes can be represented by current query text, but arbitrary structured ranges/overlap rules do not yet have a common contract. | Versioned requests for precise shades, families, proportions, remainder, range controls and composition versus overlapping global properties; each method declares support without silently changing intent. |
| Perceived relevance | The 37 related cases are development preferences from one observer; most timed top-20 results lack enough judged pairs. The loader explicitly imports the current case files and first batch. | A case/batch registry, pooled result-review batches, ingestion of further judgments, and fresh grouped validation cases. Preserve uncertainty and leave unjudged results unjudged. Additional reviewers and training-only data can follow as needed. |
| Retrieval correctness | Human agreement alone does not show whether ANN or a capped rerank missed the best results under its own score. | A candidate-specific exhaustive reference on tractable collections, same-query top-k recall/order checks, eligibility and pagination checks, and recorded completeness/bound evidence where available. Reference cost stays separate from production-path latency. Empirical recall is not a global proof. |
| Scale and resources | The default corpus path reads local image files, and returned IDs must belong to that corpus. Current trials cover 127 assets. CPU/RAM observations are limited; OpenSearch CPU/RAM are unmeasured. | Separate the small judged collection from large index-backed performance workloads; add index provenance and an eligible ID/universe contract, filters, paging, concurrency/cache profiles and resource collectors. Do not require rereading every original image before timing an existing large index. |
| Experiment reuse and combinations | Composition is written inside each adapter; current controls re-extract descriptors and create new exact indexes during setup. | Optional reusable feature/scorer/retrieval components and caches keyed by image hashes, extraction configuration and version. Preserve freedom to use different representations. Record cache hits and setup costs separately. |
| Learned methods | Groups are recorded, but there is no enforced train/development/held-out workflow. | Separate training artifacts and grouped splits, keeping final judgments out of training/tuning. A pretrained inference adapter can be tried before this infrastructure exists; claims of learned generalization cannot. |

## Comparison rules also need to grow with the methods

The current report conservatively suppresses timing deltas when execution classes differ. That prevents treating a local reference as production OpenSearch latency. As different OpenSearch strategies are added, distinguish **measurement boundary/environment** from **algorithm identity**: two strategies implementing the same end-to-end workload can legitimately be compared even when their internals differ. Their perceived relevance and retrieval loss must remain visible alongside latency.

All repeated timed rankings are saved, but the initial timed-accuracy summary uses the first successful scheduled trial per case. Approximate or nondeterministic methods warrant repeated-trial quality/stability summaries. In-process deadlines are cooperative; heavy or potentially blocking candidates may need worker/process isolation before reliable load tests.

## Recommended sequencing

Keep this runner and reporting foundation. Add the shared query/data/retrieval/workload capabilities as the experiments require them, so new method families can enter the same comparison rather than each building an incompatible benchmark. Begin with common query semantics and explicit quality-versus-retrieval checks; add large-index profiles before making million/100-million performance claims. Parameter sweeps and candidate combinations then reuse those checks.

No candidate family needs to be eliminated first. The loop should help discover which individual methods and combinations work, including where different techniques are useful for different query goals.

Implementation references: [runner](runner.mjs), [dataset loader](dataset.mjs), [accuracy policy](metrics.mjs), [report compatibility checks](report.mjs), [initial validation](VALIDATION.md).
