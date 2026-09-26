# Media Effect migration evidence

[Watch or download the recording](media-effect.mp4) · 45.0 seconds · H.264 MP4 · 599,315 bytes.

Recorded on 2026-09-26 against Media's production Docker image built from `252043c`, the existing web application and Gateway, and real PostgreSQL, SeaweedFS, NATS, and OpenSearch. Frames at 1, 10, 31, and 43 seconds were inspected. The recording shows the original 1600×900 selection, switches to 1280×720, downloads that rendition, and displays 640×360. The recorded rendition and download requests returned HTTP 200. No browser responses were mocked.

The source is `apps/web-e2e/fixtures/fixture-b.jpg`, uploaded through the authenticated browser E2E flow before recording. No database or object-store fixture seeding was needed. Wallpaper ID: `wlpr_01M3DHRTDFBA7YJ6KC677S1M56`. The recording covers delivery; Profile authority, replay, quarantine, and cancellation are established by their real adapter and production-composition tests.

## Decoded responses

Every response below was decoded with Sharp against the same production container. Successful responses have `Cache-Control: public, max-age=31536000, immutable`.

| Request | Decoded JPEG dimensions | Response bytes |
| --- | --- | ---: |
| Original, no query | 1600×900 | 39,598 |
| `w=1280&h=720` | 1280×720 | 18,537 |
| `w=640&h=360` | 640×360 | 6,647 |
| `w=800&h=600&fit=contain` | 800×450 | 11,231 |
| `w=800&h=600&fit=cover` | 800×600 | 12,485 |
| `w=800&h=600&fit=fill` | 800×600 | 12,485 |

The original response matches the committed upload fixture byte-for-byte (SHA-256 `ec87d36582ab60c13ed46b7e12eefa875e4f4e8184d9302a3e452aabe584cf11`). This vertical-gradient fixture produces identical cover/fill bytes when only the horizontal fit differs; the adapter tests establish the separate fit policies.

A zero-width query returns 400 and an unknown wallpaper returns 404. Both have `Cache-Control: no-store` and `application/problem+json`. `/ready` returns 200, and all five `/health` checks pass. The catalog contains the original and three generated variant sizes; the publication outbox is empty after dispatch.

## Validation and artifact identity

Full local `make ci` passed 73 build/check/test tasks and 10 E2E/dependency tasks in 333 seconds, after the documented Linux environment adjustment in the migration plan. Media passes 151 tests and the CRAP threshold of 30. Independent second-round Standards, Spec, and deep reviews report zero remaining findings.

The recording used production image `sha256:310106a05bce308b23034c1089e08660a2da24031c66bf1f18ff6b031d7517b9`. The complete emitted application starts as its non-root service user and runs the native resize worker successfully.

Recording SHA-256: `5c2662182b8a7b8780d2935d08c0acbff6428fe4a0bd4bd264a09066583fe9d1`.
