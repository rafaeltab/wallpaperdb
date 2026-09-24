# Utility real-corpus completion

The real utility index completed its545 document writes on2026-09-23 at01:39UTC, but the original receipt failed its final mapping comparison. OpenSearch2.11 omits explicit mapping defaults when returning a mapping. This was a validation mismatch; the original failed receipt has been preserved.

A separate read-only audit completed at2026-09-23T13:25:27.593Z:

- Index: `color-exploration-favorite-opt-real-v2` on the isolated real corpus service19216.
- UUID: `RxCWNQVESYiRLpm_37AADA`, unchanged across the audit.
- All545 documents remained indexed; all545 original measured inputs and IDs matched the frozen source receipts.
- Every file in the original indexing source archive matched current code before the audit; the archive and identity hashes were verified.
- The complete live mapping matched the requested mapping after only four explicit default normalizations: `_source.enabled:true`, object type when properties exist, float `doc_values:true`, and rank feature `positive_score_impact:true`.
- Documents at ordinals0,272,544 were independently recomputed from their original measurements and the saved utility plan. Every stored source value matched, across all encodings/presets.
- No index writes, refreshes, flushes or deletions were issued by the audit. `_mget` used POST but only retrieved documents.

Evidence is outside the worktree:

```
/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/favorite-optimization/2026-09-23/real-index-v2-completion/completion.json
```

The original failed receipt is in the adjacent `real-index-v2/index.json`. The completion folder also preserves the source snapshot used for this audit. After successful completion, the future indexing runner was updated to share this strict normalization helper. Scoring and extraction code were not changed. Re-running the original audit against subsequently changed indexing code intentionally fails its source pin; use the existing preserved completion evidence.

Validation: `make color-favorite-utility-index-test color-favorite-utility-completion-test` passes9 tests, including rejecting false defaults, changed types/fields/metadata, altered identity artifacts, incomplete writes, and unsafe output paths. A post-audit local path guard cleanup canonicalizes the worktree path; the original executed completion source remains archived in the evidence folder.
