# Wallpaper variant generation

The existing implementation owns lower-resolution renditions of uploaded wallpaper originals for device-sized delivery. The [accepted Asset generation policy](https://github.com/rafaeltab/wallpaperdb/issues/256#issuecomment-6320862525) and [ADR 0012](../../docs/adr/0012-own-stable-assets-and-immutable-sources-in-media.md) retire this separate context and the active Variant concept in the clean rebuild. The terms below describe the legacy implementation.

## Language

**Original**: The immutable wallpaper image accepted by Wallpaper Ingestion. Variant generation reads it without changing or deleting it.

**Variant**: A rendition of an original fitted within a selected resolution preset while preserving its aspect ratio.

**Resolution preset**: A named target bounding box associated with a wallpaper aspect-ratio category. Both target dimensions must be smaller than the original dimensions.

**Generation batch**: The variants selected for one uploaded wallpaper occurrence. The batch completes only when all selected variants have been stored and announced.
