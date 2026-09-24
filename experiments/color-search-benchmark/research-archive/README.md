# Color research evidence archive

Archived on 2026-09-24 when the three-option combined quality slider was selected as the direction for a future production implementation. This directory preserves research that previously existed only in the shared local evaluation directory or temporary audit scripts. The runnable prototype sources, original research notes, evaluation cases, and human judgments remain in the surrounding [experiment](../README.md).

## Contents

- [Manifest](manifest.json): provenance, original SHA256 checksums, retained locations, compression, and exact-duplicate references for **856 source records**. There are **451 physical archived files**; the other **405 records** refer to byte-identical files already retained in this archive or the repository.
- [Run summaries](run-summaries/README.md): configurations, environment, candidate summaries, accuracy, and timing from **39 feedback runs**, without raw per-case/request rows. These are derived navigation aids; the complete original Markdown and HTML reports are also preserved.
- [External artifact inventory](external-artifacts.json): paths, sizes, exclusion reasons, and checksum status for **6,013 files** retained outside Git, totaling **39,094,546,564 bytes**. This is an inventory, not a byte backup.
- `shared/`: original relative paths under `/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/`. All **61 external Markdown documents**, **42 HTML documents**, and **69 frozen source JSON bundles** are represented by copies or exact-duplicate references.
- `shared/legacy-worktree/`: the ignored original corpus-selection audit, blind comparison key, pipeline evidence, and diagnostics, where not already retained byte-for-byte elsewhere.
- `shared/temporary-helpers/`: historical task audit/browser helpers found directly in `/tmp`, with their original paths in the manifest. These scripts can contain historical service URLs and hard-coded paths; inspect them before using them.

No source images, archive of wallpapers, raster screenshots, video, OpenSearch index data, or large raw indexing/request datasets were copied. Synthetic SVG test fixtures remain in the main experiment; they are small authored test inputs. Corpus catalogs and provenance records retain image IDs, paths, hashes, and available source metadata without image bytes.

## Reading compressed reports

Text documents and JSON larger than 1 MiB are preserved with deterministic gzip compression (timestamp zero, no original filename header). Their filenames end in `.gz`; decompress them to read them, for example:

```sh
gzip -dc experiments/color-search-benchmark/research-archive/shared/runs/2026-09-20T01-03-08.336Z-08292a68/report.md.gz > /tmp/color-report.md
```

Every compressed copy was decompressed and checked against the original SHA256. The manifest records both the original checksum and stored compressed checksum. Files at or below 1 MiB are plain text. A duplicate record's `retainedAt.location` identifies whether its path is relative to the repository root (`repository`) or this directory (`archive`). Duplicate pointers are exact byte matches, not claims that two implementations are conceptually equivalent.

## Frozen favorite

The original [favorite prototype source tarball](shared/exploration/favorites/strict-hue-favorite-001/prototype-source.tar.gz) is preserved unchanged: **6,026,994 bytes**, **635 members**, SHA256:

```text
25cb051d58244b05c923adf2d52fccc470cc5600af2f0b6913c7a1dfb18a6ddd
```

It contains historical prototype source and text evidence. Its members were inspected for unsafe paths, links, images, wallpaper archives, environment files, embedded raster data, and common credential patterns. The tarball was not extracted over the working tree. Its [source inventory](shared/exploration/favorites/strict-hue-favorite-001/source-inventory.json) records the frozen version. Newer prototype variants remain in the main experiment and source bundles in this archive.

## Interpretation and reproduction

This archive intentionally retains old versions, failed experiments, superseded proposals, invalidated measurements, and corrections. A file's presence does not make its result current or its proposal accepted. Use the surrounding [current optimization findings](../exploration/FAVORITE-OPTIMIZATION-CURRENT.md), [linked slider findings](../exploration/LINKED-STRICTNESS-PROTOTYPE.md), and the later production-direction research synthesis for conclusions. In particular, earlier storage estimates were corrected; distinguish measured document counts, projected fields, and full indexes.

The original documents preserve their original links, timestamps, and absolute paths. Some links therefore still refer to local services, uncommitted image assets, raw external artifacts, or a sibling uncompressed filename. Use the manifest to resolve an archived copy, including its `.gz` suffix or duplicate location. Archiving did not rewrite historical evidence.

Source bundles capture earlier implementations at their measurement time. They are retained for inspection and reproduction, not as extra packages to execute automatically. Running them requires restoring the relevant source tree and dependencies, the documented image corpus, and the matching OpenSearch configuration. See [corpus storage](../CORPUS-STORAGE.md) and the relevant run's configuration and environment. The external original files were not modified.

Excluded non-image artifacts at or below 1 MiB have an archival SHA256; larger excluded files and image/media bytes were not hashed during this inventory. Such entries explicitly contain a null checksum and explanation. Existing corpus manifests may provide their original checksums. The exact favorite tarball is the only archived `.tar.gz` file; ordinary `.gz` entries contain compressed text or JSON.

The archive was scanned for common credential formats and embedded raster data URLs, with no matches. This is a targeted archive check, not a general security certification. See [archive verification](verification.json) for round-trip and duplicate-reference checks.
