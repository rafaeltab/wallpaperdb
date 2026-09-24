# ClickHouse precise-color comparison

The registry adds one alternative-service method, `clickhouse-palette-precision`, alongside the existing 43 OpenSearch methods. The user explicitly allowed a different service when useful; this prototype tests the cost of scanning small color palettes in a column-oriented engine. It does not train a model or change the existing OpenSearch methods.

## Execution boundary

`registry.mjs` routes this method directly to `searchClickHouse`. SQL applies all supported eligibility/exclusion predicates, calculates the precision score, and performs the final `ORDER BY score DESC, id ASC LIMIT …`. The registry, feedback adapter, and browser preserve its returned hits. They do not retrieve wallpapers for local filtering or ranking.

The method supports a single picked hex color in vibe mode, optionally with an OKLab radius and edge falloff. Named vibes, proportions, and RGB/HSV/HSL ranges are explicitly unsupported. Its image representation remains a lossy 32-color palette. Exactness describes global ordering for the stored objective, not lossless image perception.

## Corpus and evidence

Feedback preparation calls `validateClickHouseReal` on the ClickHouse table. The validator checks exact ID coverage and uniqueness against all 545 corpus assets, including every original image and ZIP wallpaper. Preparation fails on missing or replaced IDs even if the total count matches. OpenSearch count and document APIs are not used to certify the ClickHouse corpus.

Run metadata records `execution.kind: clickhouse`, the actual version, table, container limits, descriptor hashes, and source fingerprints. The native ClickHouse setup receipt is retained. The feedback report requires backend version/topology for compatible latency deltas, just as it does for OpenSearch. Resource columns use neutral backend labels and remain unmeasured when no backend resource measurement exists.

The findings summary accepts the declared real backend, and rejects local or mislabeled execution. The ClickHouse result appears with its engine label and the same coverage/accuracy caveats. No OpenSearch scale result is attributed to it.

## Visual use

Open [the browser](http://zerotwo:8225/), choose **Precise orange-red**, and select the ClickHouse method under **Other search services**. Compare it with OpenSearch's typed or precomputed precision methods. Result columns label the queried engine, including their backend timing. The fixture checkbox is forwarded into SQL eligibility filtering.

## Recorded validation

- Real backend parity covered nine queries across all 545 assets: 4,905 score comparisons, identical complete orders, and maximum score error at most `2e-7`. Eligibility, exclusion, partition predicates, and exact corpus ID checks passed.
- Feedback run `2026-09-20T02-45-21.426Z-c8b05700` completed 3 of 37 cases, with 34 explicitly unsupported and no errors. Query-macro pairwise agreement was **79.44%**, assessing 17 of 264 available pairs. This narrow coverage prevents treating it as an overall accuracy winner.
- Its 30 small-corpus timed requests had **25.28 ms p95**, **26.07 ms maximum**, and no failures. These shared-host timings do not establish million-document capacity.
- After the backend's wall-clock deadline correction, run `2026-09-20T02-52-07.682Z-6faa9adb` archived the final code with identical coverage and accuracy, no failures, **11.92 ms p95**, and **12.58 ms maximum** over 30 requests. The earlier result remains immutable; the timing difference is not evidence of a scoring improvement.
- The live browser passed **53 checks across all 44 methods**. Desktop and mobile inspection showed ClickHouse result columns, backend timing, explicit unsupported proportions, intact images, and no page JavaScript errors. See [browser validation](browser-VALIDATION.md) for receipts.
- Adapter verification tests passed 4/4, generated findings tests passed 7/7, and `make color-eval-test` passed **45 tests**.

Saved scale artifacts under `exploration/clickhouse-scale/` are included automatically in the findings page. They retain ClickHouse version, table, topology, container limits, source snapshot, CPU counters, and process RSS. No OpenSearch heap measurement is substituted. Strict scale status includes both timed requests and the matching warmups, including errors and the one-second boundary. The actual measured scale findings are recorded separately after those runs finish.
