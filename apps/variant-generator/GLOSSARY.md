# Wallpaper variant generation

Owns lower-resolution renditions of uploaded wallpaper originals for device-sized delivery.

## Language

**Original**: The immutable wallpaper image accepted by Wallpaper Ingestion. Variant generation reads it without changing or deleting it.

**Variant**: A rendition of an original fitted within a selected resolution preset while preserving its aspect ratio.

**Resolution preset**: A named target bounding box associated with a wallpaper aspect-ratio category. Both target dimensions must be smaller than the original dimensions.

**Generation batch**: The variants selected for one uploaded wallpaper occurrence. The batch completes only when all selected variants have been stored and announced.
