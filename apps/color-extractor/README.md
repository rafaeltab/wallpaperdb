# Color extractor

Color Extractor measures uploaded still images so users can discover wallpapers by color. It reads immutable originals accepted by Ingestor and publishes the complete measurements for consumers to calculate their own search utilities.

## Core capabilities

- Measures overlapping color anchors at five match-quality cutoffs and preserves named visual properties from the [selected method](../../docs/research/color-querying/METHOD.md).
- Processes still-image uploads automatically and skips videos. Transparency composites onto black, including fully transparent originals.
- Resolves producer-owned originals through immutable asset references while retaining support for historical upload events.
- Publishes extracted colors durably before marking an upload as processed.
- Retries failed extraction or publication and retains invalid or repeatedly failing messages with their original bytes and CloudEvent metadata for investigation and replay.

Sharp decodes and resamples images in an isolated process so deadlines and shutdown can stop native image work. Complete measurement bytes travel inline in retained NATS JetStream events, allowing replay without rereading the original. The [event contract](../../packages/events/src/schemas/wallpaper-colors-extracted.ts) binds measurements to their original image hash and frozen descriptor definition. Gateway owns utility calculation and search ranking.

See the [domain context](GLOSSARY.md), [decoding isolation decision](docs/adr/0001-isolate-native-image-decoding.md), and [contributor setup](../../CONTRIBUTING.md).

## Test boundaries

The [fast selection](vitest.config.ts) covers controlled extraction and availability capabilities, configuration parsing, and the frozen color anchor definition. It does not load native image adapters or the production telemetry graph. One worker reuses imported modules across these files to avoid repeated startup costs. Tests must own their state and restore changes to globals and environment variables.

The [integration selection](vitest.integration.config.ts) covers real image decoding and reference measurements, byte limits, process and socket cancellation, broker and storage contracts, HTTP, telemetry, and bootstrap artifacts. Event translation tests belong here because the public adapter entry imports the production broker graph. Keep telemetry files isolated because SDK instrumentation patches modules. Cancellation and shutdown tests retain the waits needed to exercise resource ownership.

Use the [workspace scripts](package.json) through the [standard Make commands](../../Makefile). Both selections produce complementary coverage of all source files, and [CI](../../.github/workflows/ci.yml) runs all unit and integration selections. Moving a contract to the integration selection preserves its required work. The [combined selection](vitest.all.config.ts) is available for a single coverage run across all scenarios. Integration and combined runs retain file isolation.
