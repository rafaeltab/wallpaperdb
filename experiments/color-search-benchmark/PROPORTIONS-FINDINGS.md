# Flexible color proportions: findings

## Verdict

**The prototype supports the requested query semantics.** “40% green, the rest unspecified” targets 40% total green; it penalizes both too little and too much. Complete mixtures such as 50/50 and five colors at 20% work through the same interface. Similar colors share a limited amount of image area instead of independently counting that area multiple times.

**Visual accuracy is promising but unresolved.** The new transport scorer improves average agreement with several independent pixel-composition references, but individual real queries can still produce poor results. The main remaining questions are which shades should count as a chosen color and whether suitable wallpapers exist in the collection. Increasing the palette from 32 to 128 colors changed few top-ten results in this corpus.

Try [the interactive prototype](proportions.html); run it with `make color-proportions-serve`. This work does not change production filtering.

## What changed from the previous palette search

The earlier 32-color palette represented color and area, but its search function combined color-presence scores using relative importance. A single green query behaved the same whether its weight was 40 or 100. It could not express absolute proportions.

The new default uses a small minimum-cost transport problem: distribute the image's color areas into the requested portions, paying for color differences. Unrequested area has its own destination. Sending excess green into that destination still costs something, so it cannot silently satisfy “40% green” with an all-green image. Every portion can be spent only once. The cost is our query-specific composition objective, not a standard vector L2 distance or a metric Wasserstein distance.

The UI compares three options:

| Method | What it measures | Main limitation |
|---|---|---|
| Perceptual transport, default | Joint shade and absolute-proportion fit | Shade distance and proportion error trade off; tolerance matters. |
| Direct coverage error | Difference between exclusive estimated shares and requested shares | A single smooth area estimate can lose information about which shades are present. |
| Previous palette presence score | Presence of every requested color, weighted by importance | Ignores absolute proportions; nearby colors may share evidence. |

An optional “at least” mode allows more than the requested amount. Exact-total mode is the default, following the user's explicit clarification.

## Controlled behavior and numerical correctness

All **12 behavioral diagnostics** pass. For 40% green with distant background colors, the default transport cost is approximately:

| Actual green area | 0% | 20% | 40% | 80% | 100% |
|---|---:|---:|---:|---:|---:|
| Cost, lower is better | .40 | .20 | .00 | .40 | .60 |

The exact 50/50, 80/20, and five-times-20% compositions win their controlled comparisons. Changing an unrelated background does not materially affect the 40%-green match. Duplicate colors merge; partial queries stay partial; input order does not alter cost; source area is conserved.

An independent audit passes **eight groups**, including 500 seeded problems checked against exhaustive enumeration, 500 permutations, and 1,000 continuous 2×2 problems checked against a closed-form optimum. Maximum objective disagreement was `2.22e-16`. It exposed two numerical edge cases involving tiny masses and roundoff correction; both were fixed and their reproductions now pass. This establishes solver correctness on those cases, not human relevance.

The browser includes 16 clearly labeled synthetic stripe images with known palette fractions. Their descriptors are constructed from those fractions, so they check ranking semantics and UI behavior; they are not an end-to-end image-extraction test.

## Results on 100 real wallpapers

The same checksum-pinned images from the earlier experiment were reused. Evaluation has two separate groups: 12 initially fixed queries and the eight actual editor presets. References include richer palettes and independently sampled pixels assigned exclusively to their nearest requested color within CIELAB thresholds. These remain automated proxies, not human labels.

| Comparison | Original 12 queries | Eight editor presets |
|---|---:|---:|
| 32-color transport top-ten overlap with 128-color transport | 97.5% | 98.8% |
| Previous presence score: mean pixel-reference regret, ΔE30 | .0589 | .0584 |
| Direct coverage error: same regret | .0531 | .0607 |
| 32-color transport: same regret | **.0374** | **.0351** |

Regret is the average reference error of the selected ten minus that of the best ten available; lower is better. It is not a human accuracy percentage. On the original 12 queries the broadest ΔE40 reference favored the old method (.0823 versus .0931); transport is not a universal winner. On the eight editor presets, transport improved average regret at all three tested thresholds.

The near-agreement of 32- and 128-color palettes only measures compression error within the same scoring model. It does not validate the scoring model itself. Local scoring of all 100 images took roughly **12–18 ms** for the 32-color transport implementation in typical single-/five-color runs; exact run timings are recorded in the evaluation. This excludes extraction, retrieval, network, and UI work and does not establish production-scale performance.

### Important failures and gaps

- **Scarcity:** the corpus has no close match for several saturated complete mixtures. For the actual 50/50 green-red preset, the best available independent pixel composition error is .6899. A top-ranked image is still a poor match; the editor shows the nearest result with its estimates and a mismatch notice.
- **Shade definition:** for the 40%-green preset, the best result estimates only 10.6% under the smooth OKLab model, while the independent ΔE30 pixel reference counts about 20.8%. A precise green hex and the broad everyday category “green” are different search intents.
- **An actual ranking miss:** for 40% teal / 30% cream, the first transport result has pixel-reference error .5234, while another available image reaches .1912. Palette compression barely affects this outcome. The affinity function and shade/amount tradeoff need further evaluation.
- **Dark colors:** the navy preset also disagrees with the independent pixel reference. Broad color thresholds can treat dark neighboring colors as navy; neither formula should be assumed to settle the visual question.
- **Nearby hues:** conservation prevents double counting but permits a shared intermediate shade to split between nearby targets. The model does not require distinct physical regions or enforce a particular layout.

See [the full evaluation](PROPORTIONS-EVALUATION.md) for every preset, reference threshold, ranking, and timing.

## Recommendation

Keep **32-color palettes plus joint proportion scoring** as the prototype direction. Use this editor to judge color tolerance and exact-shade versus color-family behavior on representative images before selecting the production scoring rule. A larger, deliberately composition-diverse corpus with human judgments is more informative now than simply increasing palette size.

For production, evaluate candidate retrieval separately before introducing a transport reranker. A presence-oriented OpenSearch query can omit a good exact-proportion match; the earlier retrieval-recall numbers do not establish recall for this new objective. This prototype ranks all 100 images exhaustively and adds no OpenSearch mapping, service contract, or NATS event changes.

## Reproducibility

Run `make color-proportions-diagnose color-proportions-audit color-proportions-evaluate`. The evaluator prepares data, verifies pinned sources, and records source hashes and complete rankings. [Design](PROPORTIONS-DESIGN.md), [browser checks](PROPORTIONS-BROWSER-CHECK.md), [run instructions](PROPORTIONS-README.md), and [work log](PROPORTIONS-WORKLOG.md) preserve the decisions and evidence separately from the original cosine/L2 experiment.
