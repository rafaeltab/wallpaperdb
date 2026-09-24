# Live global color-search comparison

Open **[http://zerotwo:8221/global.html](http://zerotwo:8221/global.html)** on the tailnet, or [localhost:8221/global.html](http://localhost:8221/global.html) on this machine.

The two columns execute real searches against the dedicated OpenSearch 2.11 experiment at `127.0.0.1:19216`. Original-pixel joint methods use the fixed `color-global-multi-real-v1` index; historical methods use `color-global-real-v1`. Results retain OpenSearch's ordering. There is no application candidate reranking.

## Run

From the repository root:

```sh
make color-global-up
make color-global-prepare
GLOBAL_COUNTS='' make color-global-index
GLOBAL_COUNTS='' make color-global-multi-index
make color-global-serve
```

The empty `GLOBAL_COUNTS` skips synthetic load indexes and builds only the real-image/fixture indexes needed by the UI. Original-pixel preparation reads the original corpus files and can take a few minutes. The UI binds to `0.0.0.0:8221`. It leaves the existing static report on port 8220 alone. `COLOR_GLOBAL_UI_PORT` can override the UI port for an isolated check. Stop the foreground server with Ctrl-C.

## Compare

1. Choose a preset or one to five color families and amounts. Requested amounts must total at most 100%.
2. Select a method for each column and press **Compare in OpenSearch**. Changing controls alone does not query the service.
3. Inspect thumbnails, available source-pixel family coverage, each method's amount error, and observed request timings. Open **Query and execution details** for the generated query and diagnostics.
4. Use known color fixtures to inspect constructed proportion and overlap cases. The default collection contains 100 real wallpapers.

When its dataset is prepared, the default comparison uses original-pixel joint composition and adaptive original-pixel joint composition: the same stored model and global ordering, reached through different query strategies. Both accept one to five families. The URL preserves the family amounts, both methods, collection, and result count. Opening that URL restores the controls; submit to execute fresh searches. This UI shows only the first page and closes any PIT created by a certified or adaptive search.

## Interpret the methods

| Method | Meaning |
| --- | --- |
| Original-pixel joint · 1–5 colors | Global exclusive allocation using fixed-family membership patterns measured from approximately 65,000 original-image pixels without resizing |
| Adaptive original-pixel joint · 1–5 colors | The same stored model and order, using a safely widening error bound with no token seeds |
| Native fine coverage | Global marginal coverage ranking, with pixel-derived amounts rounded to 0.01 percentage points |
| Native coverage tokens | Global marginal coverage ranking, rounded to whole percentage points |
| Certified fine coverage | Coarse seeds establish a safe bound, followed by globally complete fine ranking inside OpenSearch |
| Adaptive fine coverage | Starts at one percentage point of total fine-coverage error and safely widens until the global page is complete; no token seeds |
| Indexed joint composition | One/two fixed families, indexed pixel areas and pair unions, exclusive allocation of image area |
| Certified joint composition | Safe indexed bounds followed by globally complete joint ranking, preserving its score/ID order |
| Adaptive joint composition | Starts at one percentage point of joint-composition error and safely widens until the global page is complete; no token seeds |
| Dynamic palette ranges | One/two family regions passed to the arbitrary-range Painless query, evaluated globally against 32-color palettes |

Marginal coverage counts overlapping regions independently. Joint composition assigns each unit of area at most once. In partial joint queries, the remainder cannot absorb extra requested-region color without penalty. These are different objectives, so their error values are not interchangeable.

Amounts beside images are available family area measured from each method's own dataset. Original-pixel joint methods display `global-multi-data.json` measurements; historical methods display the earlier `global-data.json` measurements from images resized to fit within 256 × 256 pixels. Each column identifies its sampling method. Resizing can materially change narrow color membership, so comparisons across these datasets do not isolate query strategy. Compare the direct and adaptive original-pixel methods to isolate that difference.

Available family areas can overlap and are not allocated portions. Palette compression can also produce substantially different membership at narrow boundaries. This live comparison uses hard membership and amount targets; it does not implement the range editor's graded core-to-edge secondary preference.

The color-family bank is experimental and untuned. Some red-family results look pink or brown. Exact ordering for the stored model does not establish visual relevance or validate those family definitions.

Both original-pixel methods explicitly select the optimized typed scoring script for three to five families. It preserves the same model, ordered IDs, and float32 scores as the original script; one/two-family queries keep their numeric fast path. The script change does not change displayed color coverage.

Timings are single observations on a small local experiment. Browser time includes transport; server time includes query construction and service calls; OpenSearch time, when available, comes from its response. Benchmark load and warm caches affect them. No quality percentage or production-scale latency is implied.

## Server scope

- `GET /api/config` returns the current families and available methods.
- `POST /api/search` accepts only `{method, colors:[{family,amount}], cohort, limit}`. Amounts are fractions, cohort is `real` or `fixture`, and limit is 1–20.
- Only fixed builders and the two fixed experiment indexes are accessible. Clients cannot supply an index, script, arbitrary query, or OpenSearch endpoint.
- The server limits input size and concurrent searches, rejects cross-origin browser searches, serves files only within this experiment directory, and rejects incomplete OpenSearch responses.

For objective definitions, correctness conditions, and the certified-search proof, see [GLOBAL-OPTIONS.md](GLOBAL-OPTIONS.md). Experiment execution and measurement status are recorded in [GLOBAL-WORKLOG.md](GLOBAL-WORKLOG.md).

## Validation recorded on 2026-09-16

The original six methods returned live results in browser checks, using both real images and constructed fixtures. Native/certified fine searches agreed on the ordered first 20 green-query results; indexed/certified joint searches agreed on the ordered first five red/dark results. The added adaptive fine and adaptive joint paths returned live results without token seeds and closed their PITs.

Final browser checks compared direct and adaptive original-pixel joint searches for green 40%, grayscale 40%, and red/orange/yellow/green/blue at 20% each. All three agreed on the ordered first five results from the 100 eligible real wallpapers. Wallpaper 088 displayed 39.67% grayscale from the original-pixel dataset. Every adaptive search reported successful PIT cleanup. Both columns used live OpenSearch calls. URL restoration, fixture previews, input labels, desktop layout, and 390-pixel mobile layout were checked; there was no horizontal overflow or browser error.

An isolated server check also verified rejection of unknown options/index injection, invalid amounts, duplicate families, oversized bodies, cross-origin browser searches, unsupported methods, and paths outside the static-file scope. These checks cover the comparison UI; model correctness and load measurements belong to the separate benchmark probes.
