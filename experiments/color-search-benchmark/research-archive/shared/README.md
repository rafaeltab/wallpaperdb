# Shared color-evaluation image library

Reusable local source images for WallpaperDB color-search evaluation, outside any worktree.

## Contents

- `catalog.json`: 105 source images as of 2026-09-16, including paths, source URLs, SHA256 checksums, dimensions and available author/license metadata. Paths are relative to this directory.
- `corpus/`: the original 100 wallpapers, five additional review photographs, and existing thumbnails/contact sheets.
- `manifests/original-100.json`: unchanged original benchmark manifest, including historical sampling metadata.
- `manifests/initial-file-inventory.json`: checksums and byte sizes for all 207 files initially linked here, including derivatives. These are not 207 distinct wallpapers.
- `manifests/natural-green-red-sources.json`: provenance of the three latest photographs.

The user authorized downloading 1,000 or more wallpapers if useful. Expand for coverage; 105 is the current count, not a target or ceiling. The collection is a convenience sample, not representative of production uploads. The historical 100-wallpaper benchmark remains fixed.

## File ownership and reuse

The worktree at `/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/corpus/` has hard links to these files. Both paths reference the same bytes. Removing that worktree will leave this library intact. The existing review server accepts these regular files while rejecting symlinks that resolve outside its document root.

Treat source files as immutable. Recoloring, resizing or replacing bytes in place through either hard link changes both views; put any new rendition in a separate file with its own checksum. New downloads should land in this library first, followed by a hard link in any worktree that needs them. On another filesystem, make a verified copy instead.

For a new worktree, read `catalog.json`, verify source SHA256 checksums, create the same relative paths beneath its experiment directory, and hard-link each required file. Do not overwrite an existing different file. The original downloader still targets its historical worktree corpus; it has not been changed into a shared-library downloader.

## Metadata and judgments

Keep stable image IDs, original bytes, source links, available attribution/license information, dimensions and checksums when adding images. The original 100 wallpapers have unknown individual licenses; record this rather than inferring permission from their host. The additional photos carry the source metadata recorded in the catalog.

Human judgments belong in versioned case records in the repository, not this source catalog. Sampling color fractions, source titles and upstream categories are not human relevance or semantic labels. Keep related photos and variants together when eventually splitting evaluation data.

## Batch review responses

The review interface at `http://zerotwo:8222/` writes submitted human answers into `reviews/color-review-batch-001/<submissionId>.json`. Each immutable response includes a complete batch snapshot with queries, labels, source IDs and hashes, plus the submitted statuses, rank groups and raw notes. These response files survive removal of the worktree. Browser drafts alone have not been submitted; later submissions are revisions, not additional independent reviewers. The source catalog remains separate from annotations. Automated browser QA uses a temporary directory outside this library.
