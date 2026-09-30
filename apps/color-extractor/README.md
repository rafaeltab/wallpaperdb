# Color extractor

Color Extractor measures uploaded still images so users can discover wallpapers by color. It reads immutable originals accepted by Ingestor and publishes the complete measurements for consumers to calculate their own search utilities.

## Core capabilities

- Measures overlapping color anchors at five match-quality cutoffs and preserves named visual properties from the [selected method](../../docs/research/color-querying/METHOD.md).
- Processes still-image uploads automatically and skips videos. Transparency composites onto black, including fully transparent originals.
- Resolves producer-owned originals through immutable asset references while retaining support for historical upload events.
- Publishes extracted colors durably before marking an upload as processed.
- Retries failed extraction or publication and retains invalid or repeatedly failing messages with their original bytes and CloudEvent metadata for investigation and replay.

Sharp decodes and resamples images in an isolated process so deadlines and shutdown can stop native image work. Complete measurement bytes travel inline in retained NATS JetStream events, allowing replay without rereading the original. The [event contract](../../packages/events/src/schemas/wallpaper-colors-extracted.ts) binds measurements to their original image hash and frozen descriptor definition. Gateway owns utility calculation and search ranking.

See the [domain context](CONTEXT.md), [decoding isolation decision](docs/adr/0001-isolate-native-image-decoding.md), [upgrade and replay procedures](../docs/content/docs/guides/service-upgrades.mdx), and [contributor setup](../../CONTRIBUTING.md).
