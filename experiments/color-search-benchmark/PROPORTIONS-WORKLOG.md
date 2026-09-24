# Flexible proportion search — durable work log

## User request

Prototype nearest-match ranking for absolute color fractions: 40% green with the other 60% unspecified, 50% green + 50% red, or five colors at 20% each. User explicitly confirmed **40% total green should rank ahead of 80% green**, so unspecified remainder cannot freely absorb more of a requested color. Preserve the previous 100-wallpaper experiment and findings.

## Plan

- [x] Implement pure browser/Node scorer for absolute fractions and non-overlapping color mass.
- [x] Validate transport solver independently and with controlled ratio fixtures.
- [x] Reuse 100 real wallpapers; measure approximation against a richer palette.
- [x] Build interactive query editor with live nearest matches, per-color estimates, comparison modes and shareable links.
- [x] Browser-check requested examples and edge cases; record real results and limitations.
- [x] Preserve reproducible commands and final findings.

## Working design

Balanced min-cost transport from image palette weights to requested absolute fractions and a remainder bucket. Requested edge cost is `1 − exp(−OKLabDistance²/(2*tolerance²))`. The default remainder edge cost is the greatest affinity to a requested color, which penalizes excess requested color. Optional minimum mode sets remainder cost to zero. This default cost is a query-specific proportion fit, not a metric Wasserstein distance. Each source mass can be spent once. Merge identical target colors and reject totals over 100%; never silently rescale a partial query.

Transport allocations always satisfy target demand, even for bad matches, so allocations must not be displayed as observed composition. Display a separate exclusive nearest-color affinity estimate, labeled approximate; affinity-weighted allocated support is separate. Show nearest results rather than a hard threshold.

## Ownership

- Root: `proportions.mjs`, preparation, controlled diagnostics, Make commands, final docs.
- `proportion_design_audit`: mathematical design and independent solver audit.
- `proportion_ui`: `proportions.html`, `proportions-ui.mjs`, browser verification.
- `proportion_evaluation`: real-image richer-palette comparison and saved evaluation.

## Constraints

Experimental files only. Production service code and earlier benchmark artifacts are preserved. No upload, indexing, or NATS changes are required to test a new reranking function on the already extracted corpus. Keep absolute percentages distinct from importance weights, and ranking scores distinct from measured image coverage.

## Completion checkpoint — 2026-09-15

- Implemented `proportions.mjs`: exact residual-network transport, complementary remainder cost, optional minimum mode, direct exclusive-coverage comparison, and legacy presence comparison. Shared by browser and evaluation; no application dependencies at query time.
- Prepared 100 checksum-verified original wallpapers with 32-color weighted OKLab palettes; added 16 separately labeled SVG composition fixtures. The latter use known descriptors and are not extraction tests.
- UI supports up to ten color rows, partial/full compositions, presets, tolerance, two comparison columns, observed estimates, shareable URLs, real/controlled datasets, and mobile layouts.
- Final browser checks passed on the live server, including real/synthetic datasets, all requested examples, over-100% validation, ten colors, duplicates, history, mobile width, and accessibility smoke checks. Final screenshots are in the experiment's ignored `output/`; the stray root-level screenshot directory was removed by its creating agent. `PROPORTIONS-BROWSER-CHECK.md` records exact checks and remaining limits.
- `make color-proportions-diagnose color-proportions-audit color-proportions-evaluate` passed after source formatting. Twelve semantic diagnostics and all eight independent audit groups pass. The audit covered 500 exhaustive cases, 500 permutations, and 1,000 analytic cases; maximum discrepancy `2.22e-16`.
- Fixed audit findings: tiny positive residual capacities must not each be discarded by the global flow tolerance; correct an over-one floating-point query by subtracting from its largest amount.
- Evaluated 12 fixed queries plus eight actual UI presets separately. 32-color vs128 top-ten overlap: 97.5% / 98.8%. ΔE30 regret, legacy→transport: .0589→.0374 / .0584→.0351. Original fixed-group broad ΔE40 still favors legacy: .0823 vs .0931. Do not claim universal visual accuracy.
- Remaining failures are explicit in `PROPORTIONS-FINDINGS.md`: corpus scarcity, exact-hex versus named-color semantics, the teal/cream ranking miss, dark-color ambiguity, no spatial constraints. Richer palettes do not fix the main issues.
- Source hashes in prepared data and final evaluation match current sources. Earlier benchmark source files and numeric results remain separate. `git diff --check` passes; prototype and findings return HTTP200.
- Run/inspect: `make color-proportions-serve`, http://localhost:8220/proportions.html. Local server left running for inspection. Read `PROPORTIONS-README.md`, `PROPORTIONS-FINDINGS.md`, `PROPORTIONS-EVALUATION.md`, and `PROPORTIONS-BROWSER-CHECK.md` for reproduction and evidence.
- No production changes, index changes, uploads, NATS operations, commits, or publication performed for this follow-up. Scratch services from the preceding experiment remain stopped.

## If work resumes

The user's exact-total clarification is settled: 40% green should beat 80% of the same green. Do not reinterpret it as a minimum or normalize it to 100%. The current prototype is ready for user inspection. The next accuracy investigation should address shade/color-family behavior with visual judgments and a composition-diverse corpus, then independently evaluate production candidate recall. Increasing the palette size alone is not supported as the next priority by this experiment.

## Tailnet access follow-up — 2026-09-16

User could not reach `http://zerotwo:8220/proportions.html` from another tailnet PC. Investigation found no active listener and a server hardcoded to `127.0.0.1`. HTTP requests to localhost and the Tailscale IP both returned connection failure (`HTTP000`). Tailscale itself was online and healthy.

Added `COLOR_PROPORTIONS_HOST` to configure the listen address and existing-server probe. Default remains localhost. Restarted via Make with `COLOR_PROPORTIONS_HOST=100.97.42.108`, detached into its own process session; PID/log are in ignored `output/proportions-serve.pid` and `output/proportions-serve.log`. Local hostname `zerotwo` resolves to `127.0.1.1`, so verification on this machine must use its Tailscale IP. No firewall, ACL, or Tailscale configuration changes were made.

Verification after restart: `ss` shows `100.97.42.108:8220` listening; requests to the page, prepared JSON, and UI module on that address return HTTP200. The 12 preparation diagnostics pass. This confirms serving through the Tailscale interface locally; another PC's DNS/ACL path was not directly tested. Direct-IP fallback: `http://100.97.42.108:8220/proportions.html`; full MagicDNS name: `zerotwo.bun-shiner.ts.net`.
