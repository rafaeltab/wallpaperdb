# Variant generator

Variant Generator creates lower-resolution renditions of uploaded wallpapers so clients can retrieve images suited to their devices. It preserves the immutable original and announces stored variants for Media to deliver.

## Core capabilities

- Selects smaller resolution presets for standard, ultrawide, and phone aspect ratios, without enlarging images.
- Preserves image proportions and the supported source format while applying configured encoding quality.
- Stores and announces each variant before treating it as complete.
- Continues other presets after an individual failure, then retries incomplete batches while preserving already stored variants.
- Skips videos and images without applicable presets, and quarantines requests that cannot complete after retries.

Sharp resizes and encodes images in an isolated process so deadlines and shutdown can stop native work. Object storage holds the originals and variants; NATS JetStream retains generation requests and variant announcements.

See the [domain context](CONTEXT.md), [replay decision](docs/adr/0001-replay-safe-variant-generation.md), [upgrade procedures](../docs/content/docs/guides/service-upgrades.mdx), and [contributor setup](../../CONTRIBUTING.md).
