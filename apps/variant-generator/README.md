# Variant Generator

Consumes `wallpaper.uploaded` events from NATS JetStream and pre-generates lower-resolution variants of uploaded wallpapers for different device classes.

## Key Capabilities

- **Aspect-ratio-aware preset selection** — classifies each wallpaper into a category (standard widescreen, ultrawide, or portrait/phone) and selects only the resolution presets that are applicable to that category and smaller than the original
- **Streaming image processing** — downloads the original from object storage, pipes it through Sharp, and uploads each variant without loading the full image into memory unnecessarily
- **Per-format quality control** — applies configurable quality and compression settings per output format (JPEG, WebP, PNG) while preserving aspect ratio and never upscaling
- **Fault-isolated batch generation** — if one variant fails, the remaining presets in the batch continue; each successfully generated variant immediately triggers a `wallpaper.variant.uploaded` event
- **Stateless design** — holds no database and no persistent local state; all durability relies on object storage and the NATS JetStream durable consumer

## Technology Choices

- **Sharp** — high-performance image processing with streaming support, used for all resize and re-encode operations
- **NATS JetStream durable consumer** — guarantees at-least-once delivery with a long acknowledgement window to accommodate heavy processing workloads
