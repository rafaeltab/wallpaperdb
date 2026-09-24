# Color-search evaluation cases

## Scope and status

Case authoring and recording human judgments are authorized. The user now requests batches of comparisons to avoid the delay of one chat exchange per case. The [batch review interface](http://zerotwo:8222/) collects annotations; it does not run or select search methods. An algorithm evaluation harness, score formula, and implementation experiments have **not** been selected.

**Current status: 37 logical judged records — 13 prior records and all 24 comparisons from [batch 001](batch-001-results.md).** The submission contains complete strict rankings, with no submitted ties or skips. Batch case 1 and the standalone natural green/red partial-composition record are the same logical case and count once. These records are related development evidence, not 37 independent observations or a representative sample of users. The immutable [raw receipt](responses/30b36a99-4c94-4f15-9e18-27373dea04c5.json), [structured results](batch-001-results.json) and [collection workflow](BATCH-REVIEW.md) preserve query, label, source and response details.

**Batch-wide caveat:** the user said, “I have submitted the answers, I went quite quickly, so dont regard this as 100% accurate human perception preference, some of these will be ranked very differently by different people”. Treat all 24 new rankings as one observer's quick pass, with expected but unmeasured variation between people. Preserve the orders and notes without claiming definitive ground truth or inventing confidence values, weights or ties. Explicitly uncertain pairs are case 5 A/B, case 6 B/D, case 7 B/D, case 23 C/A and case 24 B/D.

| Case | Kind | Status |
| --- | --- | --- |
| composition-001 | Fully specified grayscale/red composition | User confirmed |
| composition-002 | Grayscale/red with unspecified remainder | User confirmed |
| [perceived-red-001](perceived-red-001.md) | Six real wallpapers for a general “red” query | User judged: regional estimates and overall order |
| [vibe-grayscale-001](vibe-grayscale-001.md) | Six real wallpapers for neutral grayscale intent | User judged; corrected ordering confirmed |
| [vibe-dark-001](vibe-dark-001.md) | Six real wallpapers for overall dark appearance | User judged: regional area/strength estimates and overall order |
| [combination-gray-red-001](combination-gray-red-001.md) | Six real wallpapers for mostly grayscale with red accents | User judged; review difficulty preserved |
| [combination-gray-red-002](combination-gray-red-002.md) | Three-image follow-up seeking a satisfying grayscale/red reference | User judged; A confirmed as textbook example |
| [precision-shade-001](precision-shade-001.md) | Four controlled picked-shade/amount examples | User judged; proximity semantics clarified |
| [semantic-red-city-001](semantic-red-city-001.md) | Four real images for a city subject with a red feel | User judged: C > D > A if C matches city; B excluded |
| [proportion-green-001](proportion-green-001.md) | Six controlled bands for a 40% named-green target | User judged: F > C > D > A > B > E; less-than-half intent recorded |
| [proportion-green-002](proportion-green-002.md) | Same-shade amount follow-up at 29/31/39/41/49/51% | User judged, tentative A > E > C > B > F > D; shuffled labels |
| [composition-green-red-001](composition-green-red-001.md) | Six controlled compositions for 50% green / 50% red | User judged: B > D > E > F > A > C; transfer to real images uncertain |
| [composition-green-red-real-001](composition-green-red-real-001.md) | Four natural photos for the same 50% green / 50% red request | User judged: D > A > B > C; D good but imperfect, C explicitly unwanted |
| [composition-green-red-real-002](composition-green-red-real-002.md) | Same four photos for 40% green / 40% red, remaining 20% any color | User ranked A > B > D > C in batch case 1; quick-pass caveat applies |
| [batch-001 results](batch-001-results.md) | 24 real-image comparisons spanning colors, proportions, vibes, combinations, precise shades and palettes | All 24 ranked; includes the row above and 23 new query cases; batch-wide caveat and individual uncertainties preserved |

The visual case has a [static review sheet](http://zerotwo:8221/evaluation/perceived-red-001.html) and a [separate record](perceived-red-001.json). Its confirmed overall order is **E > D > A > F > C > B**. The user's regional color-quality estimates are separate from this ordering; no whole-image absolute relevance grades have been assigned. The raw response is preserved in the record.

The red follow-up confirms A's red has higher perceived quality than F's muted red despite both sharing the initial “acceptable” label. Future reviews allow finer descriptions, scores or comparisons; no rating scale is mandatory or selected.

**Grayscale review:** [Grayscale, A–F](http://zerotwo:8221/evaluation/vibe-grayscale-001.html). These letters identify a new set of wallpapers, independently of the red case. Per-image assessments are recorded: B/D/F described as 100% grayscale, C as 0%, E as about 50–80%, and A as monochromatic but more grayscale than not. These percentages are subjective descriptions, not measured coverage. The user confirmed the first A in the written order was a typo for B. **Confirmed order: B/D/F together first, then E, A, C**, with no required ordering within the top group or equal numerical model scores.

**Dark review:** [Dark, A–F](http://zerotwo:8221/evaluation/vibe-dark-001.html). Confirmed order: **D > B > E > F > A > C**. B is described as 80% area at 70% darkness; D as 90% at 100% (generalizing a gradient); E as 60% at 100%; F as 50% at 90%. A has an approximate 10–20% foreground-associated darkness estimate, without a separate strength rating; C is described as not dark. Regional area and darkness strength remain separate from whole-image ranking. These are subjective estimates, not measured coverage or a scoring formula.

**Combination review:** [Mostly grayscale, with red accents](http://zerotwo:8221/evaluation/combination-gray-red-001.html). Confirmed order: **F > E > A > B > D > C**. The user found this hard and was reluctant to grade A. B's white-with-red appearance differs from the desired grayscale-with-red look. E has a tentative 30% grayscale-area estimate on the buildings; F is best here, with muted red roses. These observations remain separate from the explicit ordering. No ideal match or numeric whole-image grades are established, and earlier query scores/percentages do not transfer.

Before the batch, ten anchor cases and three related follow-ups supplied 13 records: two conceptual compositions, five real-image queries, three controlled queries (precision, proportion and two-color composition), plus grayscale/red, green-amount and natural two-color follow-ups. The 24 submitted comparisons bring the total to 37 logical records and broaden real-photo precision and proportion coverage. All five user goal categories have examples; this remains development evidence for discussing methods, not a representative or independent validation set.

**Two-color composition:** [50% green / 50% red](http://zerotwo:8221/evaluation/composition-green-red-001.html). **Reported fixture order: B > D > E > F > A > C.** B is the perfect example within this sheet; D is green but not very green; E has too little green and F too much. A is close to the right ratio with an extra color; C has a lot of blue with the right relative green:red ratio. Relative ratio does not imply that both whole-image amounts meet their targets. The user explicitly finds pure-color blocks difficult to judge as real wallpaper preferences, especially whether A should rank below E in a real image. Keep the order with that caveat; it does not establish a blue veto, scoring weights or a general purity-versus-amount tradeoff.

**Natural-image validation judged:** [50% green / 50% red, A–D](http://zerotwo:8221/evaluation/composition-green-red-real-001.html). **Confirmed order: D > A > B > C.** D is really good but needs brighter red and green to feel perfect; A feels nicely red and green but has insufficient red; B's red is not strong enough. C is explicitly not what the user seeks for this query, without a stated reason or hard eligibility rule. Preserve that mismatch separately from last place. No exact perceived coverage, score gaps or perfect-match reference were supplied. In particular, B's weak red does not necessarily mean too little red area. Different scenes cannot isolate the effect of blue or recreate the stripe A/E tradeoff.

**Completed batch: [24 comparisons together](http://zerotwo:8222/).** The interface supports ties and partial rankings, but this submission supplies four ranked images for every case. Raw notes, explicit statuses and the full batch snapshot are retained in the immutable receipt outside the worktree and its repository copy. Browser verification previously covered all 24 cases, response states, draft recovery, submission, retry and offline retention; QA responses remain separate from human annotations. See [BATCH-REVIEW.md](BATCH-REVIEW.md).

**Judged batch case 1:** [40% green / 40% red, remaining 20% any color](composition-green-red-real-002.md) received **A > B > D > C**, with no case-specific note and the batch-wide quick-pass caveat. It reuses the same four original photographs with its existing labels and hidden candidate amounts/scores. Whole-image targets remain 40% each; they are not normalized to 50/50. The stripe follow-up remains deferred, not cancelled. Both targets and the unspecified remainder change, so comparisons with the earlier query cannot isolate the effect of allowing other colors. The reused images and prior judgments make these related development evidence, not independent or fully blind validation.

**Next step:** discuss a provisional rubric and method options using these records. A future method's disagreement with a preference is evidence to inspect, not automatic proof of an incorrect algorithm. No further comparisons, search implementation, benchmark run or evaluation-harness choice follows automatically from this submission.

The user authorizes a larger reusable corpus, including 1,000 or more images if useful, and prefers storage outside worktrees. See [CORPUS-STORAGE.md](../CORPUS-STORAGE.md) for the shared library, source records and preserved review paths. The original 100-image benchmark manifest remains separate from the expanded review collection.

**Closer amounts, shuffled presentation 2:** [Review](http://zerotwo:8221/evaluation/proportion-green-002.html?v=2). **Tentative order: A > E > C > B > F > D**, with the user's “something like that?” preserved. A right amount, E almost right, C slightly too little, B a bit too much, F too little, D too much. No ties or explicit substantial gaps were supplied; ordinal positions do not establish score distances or a sharp halfway boundary. This belongs to the same green-target-amount group and retains the prior visible presentation in its history.

**40% green review:** [Controlled amount and shade comparison](http://zerotwo:8221/evaluation/proportion-green-001.html). **Confirmed order: F > C > D > A > B > E.** F has the right amount and is very green. B and D have the right amount but feel more gray and more yellow, respectively. A is too much, C too little, E “WAY TOO MUCH GREEN.” C20% beats A60% of the same source shade despite equal absolute deviations from40%. The user explains that40% means less than half to them, so more than half feels off. Preserve this specific asymmetry and explanation without a universal amount penalty or a50% hard cutoff. No numeric subjective green amounts, scores or exclusions were supplied.

**Precision review:** [Picked shade #FF2200](http://zerotwo:8221/evaluation/precision-shade-001.html). **Confirmed order: B/D together, then A, then C.** B/D are perceived as precise matches (“pretty sure”), A a bit light, C noticeably darker. The user clarified that the selected color signals importance of shade closeness, with nearby colors eligible; exact equality is not required. B's smaller target-color area outranks larger nearby-color regions in this case. No universal amount rule, rejection threshold or equal numerical scores for the top group are inferred. Construction facts and hashes remain separate from user observations.

**Grayscale/red follow-up:** [Three-image comparison](http://zerotwo:8221/evaluation/combination-gray-red-002.html). **Confirmed order: A > C > B.** A (telephone box) is explicitly a textbook example, with beautiful bright red and perfect grayscale. C (umbrella) has beautiful grayscale and darker but still vibrant red. B (roses, previously F) has slightly blue-ish grayscale and reduced red. A is the confirmed positive reference for this query. No percentages or calibrated numeric scores were supplied. The two additional sources have pinned local bytes and source/license records. This is related development evidence, not an independent held-out query. Source files are displayed directly in larger frames; the roses' presentation differs from the earlier review.

[cases.json](cases.json) records the two confirmed conceptual anchor cases below using a proposed minimal version 1 format. These are descriptions of wallpaper compositions, not rendered fixtures or measured real images. Practical definitions of **grayscale**, **red**, and **blue** remain undecided.

The judgments come from the user in this conversation. They establish these particular comparisons; they do not establish a universal rule about palette purity, proportion error, or allowable outside colors.

## composition-001 — fully specified grayscale and red

**Query:** “80% grayscale 20% red”

| Example | Conceptual composition |
| --- | --- |
| A | 90% grayscale, 10% red |
| B | 80% grayscale, 18% red, 2% blue |

**Confirmed judgment:** A must rank above B.

**User's stated expectation:** the 10% red / 90% grayscale wallpaper should score higher than the wallpaper with 80% grayscale, 18% red, and 2% blue.

No absolute acceptability judgment was supplied for either image. Do not turn the relative preference into “A is good,” “B is poor,” or a requirement to exclude B.

## composition-002 — grayscale and red with an unspecified remainder

**Query:** “80% grayscale 10% red”

The requested proportions total 90%; the remaining 10% is unspecified. Compare the same complete compositions:

| Example | Conceptual composition | Confirmed judgment |
| --- | --- | --- |
| A | 90% grayscale, 10% red | Good match |
| B | 80% grayscale, 18% red, 2% blue | Good match |

**Confirmed judgment:** both should score highly; either order is acceptable. This is an **unconstrained order**, not a requirement for equal numerical scores.

The user tentatively expected B might win “from a technical standpoint,” but explicitly accepted either outcome. That tentative expectation is not a mandatory preference.

**Correction preserved:** the original message said 1% red for B in this second comparison. The user corrected that to **18% red**, confirming that both cases compare the same two wallpapers. There is no unknown 17% of B.

## Recording further cases

Keep user-confirmed judgments distinct from pending questions. Record absolute relevance only when supplied, preserve acceptable alternatives, and leave numerical scoring for a later joint decision. The version 1 data shape is a record of intent, compositions, and judgments; it is not an implementation query language.

## 2026-09-21 implementation-phase follow-up

The phase statements above describe the earlier case-authoring stage. A service-backed evaluation loop and multiple OpenSearch prototypes now exist; see [the exploration work log](../exploration/PLAN.md).

The default historical dataset remains **37 logical cases**. The new optional [pagoda versus orange-sky red case](perceived-red-pagoda-001.md) records one explicit preference: `madness-wallhaven-ogg7ql` above `wallpaper-031`. The user clarifies that hue must be more similar to count. The ongoing `#FF0000` query is an explicit assumption, not a fresh quoted hex request. Images were chosen from ranked results, so this is selected development feedback rather than blind validation.

Include it with `--extra-cases evaluation/perceived-red-pagoda-001.json` in `make color-exploration-evaluate COLOR_EXP_ARGS='…'` to produce a 38-case run. Its JSON and source hashes enter the dataset snapshot. Report this follow-up separately when comparing against historical 37-case accuracy; no earlier annotations or historical run records are replaced.
