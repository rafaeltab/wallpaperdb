# Color Extractor

Color Extractor describes the visible colors of wallpaper images so users can discover wallpapers by color.

It computes alpha-weighted HSV histograms from immutable originals, skips videos, and publishes results for the catalogue. Sharp provides image decoding and resampling.

Binary CloudEvent quarantine records retain the input envelope in `original-ce-*` headers. Operator replay restores these headers alongside the original body so source, occurrence, correlation, and causation survive retries.

`COLOR_EXTRACTOR_QUARANTINE` requires file storage, limits retention, discard-new overflow, at most 1 GiB, and exactly 30 days of retention. Startup rejects incompatible existing policies. Migrate existing stream configuration explicitly without purging retained input; export older evidence before applying a shorter retention window.

Oversized quarantine input is stored in acknowledged chunks followed by a manifest. Before replay, resolve its sequence references and verify total bytes and SHA-256. Restore the manifest's `original-ce-*` headers together with the reconstructed body. Partial handoffs leave the input pending and resume after capacity returns.
