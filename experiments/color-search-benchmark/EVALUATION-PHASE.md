# Proposed phase: evaluate methods against user intent

Status: **build and use the feedback loop before narrowing methods.** The user corrected the premature shortlist: a repeatable accuracy/performance evaluation should enable broad experiments, combinations and optimization. The [evaluation loop](evaluation/loop/README.md) is the current deliverable. The [case index](evaluation/CASES.md) contains 37 logical judged records: 13 prior records plus 24 batch comparisons. Related queries and reused images mean these are not 37 independent observations. The first loop uses an explicit, versioned provisional metric policy and existing formulas as integration controls; no search architecture or production acceptance thresholds are selected.

## Completed batch and next discussion

On 2026-09-18 the user requested many comparisons at once because the sequential process was taking too much time. [Batch 001](evaluation/batch-001.md) presents 24 comparisons, four images per comparison, using 62 distinct existing sources. The receipt saved on 2026-09-19 contains all 24 complete strict rankings, with no submitted ties or skips. Case 1 is `composition-green-red-real-002`, with its exact query, labels, images and source hashes preserved; the remaining 23 are new query cases. Do not count the standalone case 1 record twice. See the [results and raw notes](evaluation/batch-001-results.md), [structured results](evaluation/batch-001-results.json) and immutable [raw receipt](evaluation/responses/30b36a99-4c94-4f15-9e18-27373dea04c5.json).

The user explicitly qualified the whole batch: “I have submitted the answers, I went quite quickly, so dont regard this as 100% accurate human perception preference, some of these will be ranked very differently by different people”. These are provisional preferences from one observer's quick pass. Variation between people is expected, not measured; no numerical confidence or weight is inferred. Retain every submitted order alongside its notes. Cases 5 (A/B), 6 (B/D), 7 (B/D), 23 (C/A) and 24 (B/D) explicitly identify uncertain pairs; do not replace those orders with invented ties. Case 17's unexplained C > B preference is explicitly felt, not an uncertain order. Case 19's black/dark remark remains ambiguous, not a rule excluding black.

The [method-choice discussion paper](METHOD-CHOICE-DISCUSSION.md) retains useful method research, but its shortlist-first recommendation was rejected by the user. The next work is the common feedback loop, which must accept new methods and combinations without requiring a narrowed candidate set. Treat disagreement with these preferences as evidence to inspect, not automatic proof of an incorrect algorithm. No additional comparison batch is required to establish the initial loop.

The annotation collection interface remains available at **http://zerotwo:8222/**, separate from the deferred algorithm evaluation harness. It accepts ties, partial rankings, optional notes, notes-only responses, unsure, none-match and skipped states. Images omitted from a partial ranking are unjudged, not rejected. Browser drafts reduce repeated work; explicit submission writes an immutable receipt under `/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/reviews/color-review-batch-001/`. Each receipt includes the complete batch snapshot so the original query, labels and source hashes can be recovered, plus raw notes and explicit statuses. See [BATCH-REVIEW.md](evaluation/BATCH-REVIEW.md) for the collection workflow. Browser verification passed for all 24 rendered cases, desktop/mobile layout, draft restore, response states, submission and retries. Concurrent-tab and damaged-draft safeguards were exercised. Synthetic QA responses remain separate from the submitted human judgments.

All 105 library source images remain available; this batch needs no additional downloads. Related queries and reused images are development evidence and must remain grouped in later evaluation splits. No candidate scores or expected orders are supplied, and no method, scoring rule or architecture is selected by collecting responses.

## Previously judged cases

The [grayscale](evaluation/vibe-grayscale-001.md) review is complete: B/D/F together first, then E, A, C, with the user's initial typo corrected and preserved. A monochromatic tint can partly fit the user's grayscale intent while ranking below the neutral examples; E's dark areas leave uncertainty. These are specific judgments, not a numeric grayscale threshold.

The [dark](evaluation/vibe-dark-001.md) review is complete: D > B > E > F > A > C. Regional area and darkness-strength estimates are recorded separately; D's gradient approximation and unannotated remainders are preserved. These judgments complete the proposed first review batch below.

The [**mostly grayscale, with red accents**](evaluation/combination-gray-red-001.md) review is complete: F > E > A > B > D > C. The user found grading difficult, especially A; preserve that alongside the explicit order. F is best here with a muted-red limitation, and B's “white with red” does not feel like the intended grayscale/red combination. This initial set did not establish an ideal reference.

The [three-image follow-up](evaluation/combination-gray-red-002.md) is now judged: **A > C > B**. A (telephone box) is explicitly a “textbook example,” providing a confirmed positive reference. C (umbrella) has darker but still vibrant red; B (roses) has reduced red and slightly blue-ish grayscale. These are different scenes, not controlled variants, and the same-query reviews belong to one development group. Source files are displayed directly in larger frames, so prior and new presentation are not identical. The [picked shade #FF2200 case](evaluation/precision-shade-001.md) is now judged: B/D together, then A, then C. The user clarified a preference for colors as close as possible, with near colors eligible rather than requiring equality. Preserve “pretty sure” for B/D, A's perceived lightness and C's perceived darkness; no rejection threshold or universal amount rule is inferred. This controlled case needs later real-wallpaper validation. The [city with a red feel review](evaluation/semantic-red-city-001.md) is judged: C > D > A assuming C matches the city tag, with B excluded for subject mismatch despite matching red. A and D remain eligible with weak red matches. C may be a village; the user would accept the author's identification, but its actual tag has not been verified. This required-tag interpretation is specific to this case. All five goal categories now have initial evidence. The [40% green review](evaluation/proportion-green-001.md) is judged: F > C > D > A > B > E. F has the right amount and is very green; B and D have the right stated amount but feel more gray and yellow, respectively. C20% beats A60% using the same source shade and equal absolute target deviations. The user explains that 40% feels like less than half, and more than half feels off. This supports asymmetry for these examples without defining a 50% cutoff or universal amount penalty. The shuffled, amount-hidden [closer-amount follow-up](evaluation/proportion-green-002.md) is judged with a tentative order: A > E > C > B > F > D, qualified by “something like that?”. A is right amount, E almost right, C slightly too little, B a bit too much, F too little, D too much. Under-target examples beat equal-error over-target counterparts in this tentative order, but B > F prevents a blanket less-is-better interpretation. No explicit interchangeability groups or substantial gaps were supplied, so no sharp halfway boundary or preference strength is established.

The [50% green / 50% red composition review](evaluation/composition-green-red-001.md) is judged: **B > D > E > F > A > C**, with an explicit caveat about transfer from pure-color blocks to real wallpapers, especially A versus E. Preserve the fixture order without inferring a universal extra-color veto or scoring tradeoff. B is perfect within this constructed set. A/C's relative green:red ratio observations are distinct from whole-image amount correctness.

The [natural-image validation](evaluation/composition-green-red-real-001.md) is judged for the same 50% green / 50% red query: **D > A > B > C**. D is really good but would need brighter red and green to feel perfect. A feels nicely red and green with insufficient red; B's red lacks strength, without a separate area judgment. C is explicitly not what the user wants for this query; no reason or hard exclusion rule was supplied. Preserve these observations without assigning exact coverage, numeric scores, an ideal reference or a universal brightness rule. The different scenes cannot isolate the effect of blue or resolve the stripe A/E comparison.

The [natural-image partial-composition review](evaluation/composition-green-red-real-002.md), preserved as case 1 of the batch, received **A > B > D > C** for **40% green, 40% red, remaining 20% any color**, with no case-specific note and the whole-batch caveat above. It uses the same four original photographs with fresh shuffled labels and candidate amounts/scores hidden. Targets remain whole-image amounts rather than a normalized 50/50 ratio. This adapts the previously authorized partial-query direction to photos; the stripe version stays deferred, not cancelled. Both targets and the unspecified remainder change, so response differences cannot be attributed exclusively to remainder flexibility. Keep these reused images and queries together as related development evidence; shuffling does not remove recognition or make them independent, fully blind or held-out.

The red review showed the initial four-label scale was too coarse, so subsequent reviews accept finer descriptions, scores and relative preferences without mandating a scale.

## Purpose

Choose color-search methods using a repeatable evaluation contract grounded in [the user's goals](COLOR-QUERY-GOALS.md). A precise implementation of an unsuitable formula is not a successful search experience. Existing prototypes and synthetic scale results are evidence available for discussion, not privileged candidates or a finished benchmark.

## Proposed evaluation contract

An evaluation case contains a query/intent, the eligible collection and metadata constraints, relevance judgments or explicit comparison preferences, and a category. Each candidate produces a ranked list of wallpaper IDs for the same case. Evaluate result ordering and useful matches rather than comparing raw scores from different candidate formulas.

Maintain separate kinds of evidence:

1. **Concrete behavioral examples.** Small controlled cases clarify amount targets, unrequested colors, overlap, precise shade differences and unspecified remainder. These establish specific behavior, not a complete model of perception.
2. **Judged real wallpapers.** People assess query/image relevance or blinded pairs of results against a written rubric. This is the primary proposed evidence for perceived color, vibe and combination quality. A vision model could assist labeling or find disagreements, but its judgments would need human calibration; it should not define correctness by itself.
3. **Retrieval correctness.** Compare production-style retrieval against exhaustive scoring under each candidate's own objective on a tractable reference collection. This detects omitted winners or incorrect pagination, not whether people like the objective. Clearly distinguish a proven completeness guarantee from measured recall on a finite dataset.
4. **Operational evidence.** Measure actual OpenSearch execution separately at agreed scale, selectivity, cache state and concurrency. Include coordinator overhead and all requests in the user-visible search path. Early local experiments cannot establish production or 100M capacity by themselves.

### Preserve uncertainty in judgments

Record “A preferred to B,” “B preferred to A,” “both acceptable, no ordering requirement,” “both poor,” and “uncertain” distinctly. An unconstrained order does not require equal numerical scores. Uncertain cases are not failures or negative relevance labels.

Confirmed example:

| Query | A: 90% gray / 10% red | B: 80% gray / 18% red / 2% blue | Judgment |
| --- | --- | --- | --- |
| 80% gray / 20% red | Preferred | Less preferred | A must rank above B in this comparison |
| 80% gray / 10% red | Good | Good | Both acceptable; no required order |

The user's tentative technical preference for B in the second row is not a mandatory ranking label.

The first real-image review supplied another important distinction: **quality and estimated amount of red in image regions versus overall perceived-redness order**. Record both independently. Do not convert “10% great red” into a great-match label for the whole wallpaper, or treat the user's visual percentage estimates as exact measured coverage. See [perceived-red-001](evaluation/perceived-red-001.md).

## Proposed case-creation process

### 1. Write small case cards from user stories

Start with a few cases and grow toward roughly ten reviewed anchor cases covering all five goal categories. This is a proposed initial size, not a statistically sufficient final benchmark. The two grayscale/red comparisons already supply two anchor cases and need not be relabeled.

Each card contains:

- A stable ID and the goal category (multiple categories may apply).
- The user's query and a short statement of intended appearance, independent of any representation or query DSL.
- Explicit metadata constraints and the eligible image collection when relevant.
- Example wallpaper IDs or constructed compositions.
- Per-image judgments, any confident pairwise preference, and a short reason.
- Whether the expectation is confirmed, tentative or unresolved; who judged it and the case version.

Do not require numerical relevance scores at authoring time. The initial **great match / acceptable / poor match / unsure** scaffold proved too coarse for the user's finer red-quality judgments. Allow descriptions, relative comparisons and finer scores when the user supplies them; a common numerical scale is not yet chosen. Sharing a categorical label does not imply equal quality. Keep regional color-quality judgments, estimated area, and whole-image preference separate. “Both acceptable; either order works” is a known permissive judgment, distinct from “unsure.”

### 2. Use controlled examples and real images for different questions

Controlled examples isolate ratios, precise shades, extra colors and an unspecified remainder. They can preserve otherwise similar properties while changing the one behavior being discussed. Their known compositions establish what is present, while the user's judgment establishes which result should be preferred.

Real wallpaper examples establish whether a result feels red, dark, muted, monochromatic or like a neutral background with colored accents. Include plausible matches, near misses and clear mismatches. For example, a substantial red/orange area, a tiny exact-red accent and a pink-dominant image are useful things to compare for a red query; their ordering must be judged rather than automatically assigned by a color-distance formula.

The original 100-wallpaper corpus is a starting collection, not a representative sample of all production wallpapers. The user authorizes downloading 1,000 or more images if useful and prefers reusable storage outside worktrees. The shared library at `/home/rafaeltab/.local/share/wallpaperdb/color-evaluation` holds 105 source images after the latest additions: the original 100, two earlier review photos and three new photographs. See [CORPUS-STORAGE.md](CORPUS-STORAGE.md) for provenance and hardlinked review paths. The original benchmark manifest remains unchanged.

Expand for missing visual coverage rather than treating image count as evaluation quality. New images remain unjudged until reviewed; material exposed in development cannot later become untouched held-out evidence.

### 3. Keep each comparison small and make many available together

The current workflow presents 24 comparisons together, each with four images, so the user can review them at their own pace without waiting for chat. The small visual groups preserve readability; they do not require a separate conversation turn. A ranking or partial ranking is enough, notes are optional, and ties, uncertainty, notes-only responses, explicit none-match feedback and skips are valid. Do not require every pair, a full order, numerical scores or an explanation for every image. Images omitted from a ranking stay unjudged. Do not reinterpret an estimated area percentage as a quality score.

Keep presentation size/background consistent, permit closer inspection, and show a reference swatch for a precise shade query. Randomize positions and hide candidate-method identities and computed match scores during visual judgments. Exact composition facts can be shown when reviewing a controlled amount case; they should not substitute for visual judgments on natural wallpaper vibes.

Select initial images deliberately and independently of a single candidate's output. Once experiments are approved, broaden the review pool with results from multiple approaches and difficult counterexamples. Any new unrated result remains unjudged until reviewed.

### 4. Broaden coverage with nearby and difficult cases

Use a coverage checklist rather than accumulating only easy red/blue examples:

| Goal | Example questions for case selection |
| --- | --- |
| Perceived color | Substantial related color versus a small exact-color patch; red family versus pink or orange interpretations |
| Vibe | Strict grayscale versus tinted monochromatic; dark with bright accents versus more uniform lightness |
| Combinations | Fully versus partially specified palettes; neutral background and accents; fall or flag-inspired palettes |
| Precision | Nearby hexadecimal shades with otherwise comparable amounts; broad named-color intent versus a specific shade |
| Semantic filtering | Subject constraints plus appearance; rainbow colors in non-rainbow subjects |

Record new variants as questions until judged. Do not infer a universal rule from a single comparison. Include cases where there is no good available match and distinguish that from a retrieval failure. A small anchor group verifies its particular judgments; it does not establish a complete ranking over the entire collection.

### 5. Separate examples used for tuning from final evaluation

After the rubric is stable enough, retain development cases for the optimization loop and reserve different query/image groups for finalist comparison. Keep related images and close query variants together so a trivial near-duplicate does not masquerade as new evidence. Held-out judgments should not drive repeated parameter changes. Extend the judged collection over time without silently changing the meaning of historical scores.

### Initial review sequence completed; current batch broadens coverage

The first red, grayscale and dark reviews, the conceptual anchors and their later follow-ups are preserved in the 13 prior records. The 24 submitted comparisons in [batch 001](evaluation/batch-001-results.md) broaden coverage through real-image comparisons, bringing the total to 37 logical judged records. The whole-batch quick-pass caveat and specific uncertainties remain part of the evidence. Algorithm evaluation framework and method selection remain later joint decisions.

## Proposed scorecard

| Priority | Evidence to show | Treatment to discuss |
| --- | --- | --- |
| Perceived accuracy | Agreement with pairwise preferences; useful results among the first results; ranking quality using judged relevance | Minimum quality per goal category, plus overall quality |
| Perceived speed | End-to-end median and tail latency, failures/timeouts, sustained concurrency under declared conditions | Agreed latency/failure budgets |
| Flexibility | Coverage and quality of Perceived color, Vibe, Combinations, Precision and Semantic filtering cases | Explicit supported/unsupported capability matrix |
| Service CPU and memory | CPU per completed query, process memory under load | Guardrails and comparison among quality/speed-acceptable methods |
| OpenSearch CPU and memory | CPU per completed query, heap/native/cache observations under load | Guardrails and comparison among quality/speed-acceptable methods |
| OpenSearch storage | Bytes per wallpaper, mapping/indexing costs and update requirements | Secondary tradeoff |

Exact metric definitions and category weights require agreement. A candidate must not silently omit unsupported query cases to improve its quality average. Aggregate scores should not hide a failure on precise shades or grayscale/accents behind many easy color queries.

Avoid a freely compensating top-level weighted sum: storage or resource savings should not cancel unacceptable relevance or latency. First agree on minimum quality and maximum latency expectations; compare the remaining tradeoffs explicitly. A scalar quality objective could support later parameter tuning within those constraints, while preserving every component score and its uncertainty.

## Proposed phases and loop

### First: agree what good means

- Turn representative user stories into a manageable set of query cases and preference judgments, including difficult and no-good-match examples.
- Agree on the rubric, how to record disagreement, and which cases are essential.
- Agree on latency measurement conditions and budgets; do not infer them from the fastest historical measurements.
- Review examples together before treating the rubric as an optimization target.

### Current direction: establish the common loop before selection

- Use common method adapters, versioned judgments/metrics, repeatable workload definitions and preserved run artifacts.
- Let each method, configuration and combination enter as an experiment; no shortlist is required first.
- Inspect category failures, actual returned results, coverage, latency and regressions before narrowing any search architecture.

### Iterative feedback

1. Establish a baseline on the fixed development cases.
2. Inspect failures by goal category and representative images.
3. Change a defined hypothesis or parameter set.
4. Rerun the same comparisons and operational checks where relevant.
5. Retain improvements that meet the agreed requirements and explain any regressions.
6. Periodically review ambiguous examples together; version any rubric changes and compare candidates under the same rubric version.
7. Compare finalists on held-out queries and image groups that were not used for iterative tuning.

The loop can eventually automate candidate runs and parameter exploration. Human review remains responsible for whether the evaluation target matches the desired product behavior. Do not use a candidate's color-distance formula as its own perceptual ground truth. Repeatedly tuning on held-out results turns them into development data; preserve a final untouched comparison.

## Evaluation hygiene to agree before execution

- Combine constructed cases with diverse real wallpapers. Keep related images and color variants together when separating development and held-out groups.
- Judge a pooled set of results from multiple approaches and deliberate counterexamples. Unjudged images are not automatically irrelevant; new candidates can reveal gaps in the judgment pool.
- Randomize comparison presentation and conceal method identity during visual review. Preserve disagreement and confidence rather than fabricating a total order.
- Version corpus/image hashes, queries, judgments, candidate configuration, extraction/index versions, hardware and run conditions.
- Separate result-quality evidence from descriptor-fidelity checks and from exact-retrieval checks.
- Show per-category results, example failures and uncertainty alongside aggregates. Define treatment of unavailable matches and unsupported capabilities explicitly.
- Measure changing queries, metadata-filter selectivity, realistic concurrency and declared cache conditions. A local timing of the scorer alone is not end-to-end search latency.

## Tooling

The first [evaluation loop](evaluation/loop/README.md) uses a small Node runner with pluggable candidate modules, deterministic accuracy metrics, timed adapter calls, parameter sweeps, immutable JSON artifacts and HTML/Markdown comparisons. Its initial metric policy is explicit and versioned, not a universal perceptual truth or selected search architecture. [EVALUATION-TOOLING.md](EVALUATION-TOOLING.md) retains earlier tool research. The separate batch annotation interface remains on port 8222; the read-only run report server uses port 8224.
