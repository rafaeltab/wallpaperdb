# Color extractor

Color Extractor measures uploaded still images so users can discover wallpapers by color. It reads immutable originals accepted by Ingestor and publishes the complete measurements for consumers to calculate their own search utilities.

## Core capabilities

- Measures overlapping color anchors at five match-quality cutoffs and preserves named visual properties from the [selected method](../../docs/research/color-querying/METHOD.md).
- Processes still-image uploads automatically and skips videos. Transparency composites onto black, including fully transparent originals.
- Resolves producer-owned originals through immutable asset references while retaining support for historical upload events.
- Publishes extracted colors durably before marking an upload as processed.
- Retries failed extraction or publication and retains invalid or repeatedly failing messages with their original bytes and CloudEvent metadata for investigation and replay.

Sharp decodes and resamples images in an isolated process so deadlines and shutdown can stop native image work. Complete measurement bytes travel inline in retained NATS JetStream events, allowing replay without rereading the original. The [event contract](../../packages/events/src/schemas/wallpaper-colors-extracted.ts) binds measurements to their original image hash and frozen descriptor definition. Gateway owns utility calculation and search ranking.

See the [domain context](GLOSSARY.md), [decoding isolation decision](docs/adr/0001-isolate-native-image-decoding.md), [upgrade and replay procedures](../docs/content/docs/guides/service-upgrades.mdx), and [contributor setup](../../CONTRIBUTING.md).

## Test boundaries

The [fast selection](vitest.config.ts) covers controlled capabilities, configuration and frozen color anchors without native image adapters or production telemetry. Its single worker reuses modules, so tests must restore globals and environment changes.

The [integration selection](vitest.integration.config.ts) covers native decoding and reference measurements, byte limits, process/socket cancellation, broker/storage contracts, HTTP, telemetry and bootstrap artifacts. Event translation belongs here because its public adapter imports the production broker graph. Keep telemetry files isolated because SDK instrumentation patches modules. Preserve real waits that test cancellation and shutdown ownership.

Run [workspace scripts](package.json) through [Make](../../Makefile). CI runs both selections, which cover all sources with complementary reports. The [combined selection](vitest.all.config.ts) provides one coverage run; integration and combined runs retain file isolation.
