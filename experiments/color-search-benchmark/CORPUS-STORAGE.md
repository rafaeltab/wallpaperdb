# Reusable image storage

The shared library is at:

`/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/`

As of 2026-09-18 it still contains **105 source images**: the historical 100-wallpaper corpus, two photographs from `combination-gray-red-002`, and three photographs for `composition-green-red-real-001`. Existing thumbnails and contact sheets are also retained. Its `catalog.json` records stable IDs, original file paths, SHA256 checksums, dimensions, sources and available author/license metadata. The original 100-image manifest is backed up separately and remains unchanged in this experiment.

## Reuse across worktrees

The experiment's `corpus/` paths are hard links to the shared files. Review URLs remain valid, and deleting this worktree does not remove the library. Hard links avoid duplicating the image data. They also work with the current review server's rule that resolved paths must stay inside its document root; an external-directory symlink would fail that check.

To use an image in another worktree, find it in the shared catalog, verify its checksum and create its relative path under that experiment's directory. Hard-link the source file there, or copy and verify it if the destination is on another filesystem. Do not overwrite a different existing file. Treat shared source files as immutable: editing a hard-linked file in place changes every view of it. Store derivatives as new files with their own hashes.

The shared library's `README.md` describes its inventory and ownership. `manifests/initial-file-inventory.json` covers the 207 files initially linked there, including derivatives; this is not a wallpaper count. The three new images were subsequently downloaded as original source files, copied into shared storage and hard-linked into this worktree.

The historical corpus downloader still writes into its worktree directory. This storage migration does not change that tool or its 100-image selection. Use shared storage first for future evaluation sourcing, then expose verified files in the worktree as needed.

## Batch review responses outside the worktree

The user requested batches of comparisons on 2026-09-18 to reduce chat round trips. [Batch 001](evaluation/batch-001.md), available at **http://zerotwo:8222/**, uses 62 existing source images in 24 four-image comparisons. No source files or catalog entries were added for this batch. The pending natural green/red partial-composition case is included as case 1, preserving its existing query and labels; it is not a duplicate independent case.

Submitted annotations live alongside the reusable corpus:

`/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/reviews/color-review-batch-001/<submissionUUID>.json`

Draft answers stay in the browser until explicit submission. The collection server writes each submission as an immutable JSON receipt with its complete `batchSnapshot`, including query text, candidate labels, source IDs and hashes, plus raw notes and explicit response statuses. This keeps the submitted evidence recoverable after removal of the worktree. Treat receipts as immutable records; do not overwrite older submissions when interpreting or reconciling later responses.

Ties and partial rankings remain as supplied; omitted images are unjudged. Notes-only, unsure, none-match and skipped states are recorded distinctly. The first human submission on 2026-09-19 contains all 24 complete rankings, bringing the logical judgment-record count to 37 including the earlier 13. [Results](evaluation/batch-001-results.md) preserve the user's quick-review caveat and specific uncertainty separately from the orders. See [BATCH-REVIEW.md](evaluation/BATCH-REVIEW.md) for collection, resumption and response handling. The review service is an annotation interface, not an algorithm evaluation harness.

The original receipt `reviews/color-review-batch-001/30b36a99-4c94-4f15-9e18-27373dea04c5.json` remains byte-identical. Its later conversation caveat and derived record are also saved under `reviews/color-review-batch-001/annotations/30b36a99-4c94-4f15-9e18-27373dea04c5.json`. Annotation sidecars are not additional submissions. An exact receipt copy and results are retained in the repository; the source catalog remains free of judgment labels.

## Scope and evidence

The user explicitly authorized downloading 1,000 or more wallpapers if helpful, and requested storage outside worktrees for reuse. Expand according to missing evaluation coverage; there is no 100-image cap. This is permission to source evaluation material, not authorization to restart deferred algorithm prototypes or benchmarks.

Original image bytes are retained. The original 100 wallpapers have unknown individual licenses; the five added photographs have source and license records. Do not infer rights from hosting alone. The shared catalog excludes historical `selectionCoverage` values to avoid confusing sampling measurements with user judgments; the original manifest retains them for reproducibility.

Human observations, queries and presentation mappings remain in [evaluation/CASES.md](evaluation/CASES.md) and its linked case records. More images provide coverage; they do not automatically provide more judgments or a representative held-out set.
