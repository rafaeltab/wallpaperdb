# Variant generator Effect migration evidence

[Watch the browser recording](variant-generator-effect.mp4) · 37.6 seconds · H.264 MP4 · 1,576,402 bytes.

Recorded on 2026-09-24 against the migrated worker built from `ad2274e`, built Media and Gateway, the existing web application, and isolated real NATS, SeaweedFS, PostgreSQL, and OpenSearch instances. Frames at 1, 22, and 36 seconds were inspected.

The fixture uploaded a fresh 3840×2160 JPEG derived from `apps/web-e2e/fixtures/fixture-b.jpg` to object storage and published `wallpaper.uploaded`. Media and Gateway projected the original before the worker started. The recording shows the original alone, then six generated variants after starting the migrated worker and refreshing. It selects 1920×1080, downloads it, and displays 640×360. Browser requests to Gateway GraphQL, Media image URLs, and the 1920×1080 download returned HTTP 200. No browser responses were mocked.

This proves the generation-to-display path. The original was seeded through S3 and NATS, so it does not exercise authenticated upload through Ingestor. Local fixture processes used development CORS settings. The pre-existing Media bundle needed links to its already-installed `ioredis` and `@opensearch-project/opensearch` dependencies in ignored `node_modules`; no Media source or behavior was changed.

## Decoded objects

Every stored object and every Media response was decoded with Sharp. All were JPEGs. Stored byte lengths matched the published metadata. Media re-encodes responses, so response byte counts can differ.

| Published dimensions | Stored and served dimensions | Stored bytes |
| --- | --- | ---: |
| 3840×2160 | 3840×2160 | 112,553 |
| 2560×1440 | 2560×1440 | 48,019 |
| 1920×1080 | 1920×1080 | 34,942 |
| 1600×900 | 1600×900 | 27,257 |
| 1280×720 | 1280×720 | 17,688 |
| 854×480 | 853×480 | 10,833 |
| 640×360 | 640×360 | 6,639 |

The 854×480 preset retains the existing `fit: inside` behavior: an exact 16:9 source encodes to 853×480, while metadata describes the preset bounds. The previous implementation behaved the same way.

## Event evidence

Wallpaper: `wlpr_01JVIDEOEFFECT0000000000000`. Input occurrence: source `wallpaperdb/ingestor`, ID `variant-effect-video-upload`. All six output messages were stored by JetStream, used source `https://wallpaperdb/variant-generator`, and carried that input ID as `ce-causationid`. Binary CloudEvents `ce-id` matched the legacy payload's `eventId`.

| Preset | Output occurrence ID |
| --- | --- |
| 2560×1440 | `c37a7e7871c9bf09a4a559e84904c87ab4b54d20808f73caf8db2a237e7b44d4` |
| 1920×1080 | `f09ec1532fd51a93142b41b19b6bbd7a70ffb7a57d28ce3d8b31455aed6c85d0` |
| 1600×900 | `2fa4700f6597bb8f3351afa18d542635c90c6cd819ccff49fae02d6114764059` |
| 1280×720 | `54c7b203ddcb9c3d15087b47c95b7128eeb3eab4a6ffcc7dfa8057eb886a0c3d` |
| 854×480 | `ef3e51c33e0f50f9beb64c2c4b2eb557548f7b12a724034ac9baf6061479be19` |
| 640×360 | `a6ac30f10fabcf38e54b4b3812ba6d1a7aa21b76b6bd860a62ff446b918ef54e` |

Stable variant storage identities and output event occurrences support replay. This demonstration does not claim end-to-end exactly-once delivery. Media's existing variant consumer has no processed-event ledger; replay beyond broker deduplication can duplicate its rows.

## Artifact hashes

The recording predates the unsupported-format diagnostic and quarantine follow-ups. Successful generation and encoding are unchanged by those fixes; their focused tests and final CI provide separate evidence.

SHA-256 of the files used during the recording:

- `apps/variant-generator/dist/index.mjs`: `424eef176aa543a9cac202f1db40c60b895faff16acda900627222af7a956db4`
- `apps/variant-generator/dist/server-INU7ZFZP.mjs`: `d2a2db895ad53d0a27b905da898fc4ea82a3f655e7f122574a53b51860e0fcee`
- `apps/variant-generator/dist/encoder.mjs`: `f616f3f7fa1fc6d79b87ccfdc630ab18ccbc9fe22ff9ca5aa1946f5552c1240b`
- `variant-generator-effect.mp4`: `234248a6718753d63f48050d18580feec8e8529c7df42428df09b0d309e96615`
