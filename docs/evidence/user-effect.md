# User Effect migration evidence

[Watch or download the recording](user-effect.mp4) · 50.3 seconds · H.264 MP4 · 1,070,839 bytes.

Recorded on 2026-09-26 against User's production Docker image built from `7d20588c015a70f3049a31343fa80733c081f152`, the existing web application, Gateway and Media, and real PostgreSQL, NATS and SeaweedFS. Frames at 2, 14, 32 and 49 seconds were inspected. The recording changes the display name to Quiet Skies, edits the Biography, uploads a picture, opens the public Profile, and removes the picture to restore the generated avatar. No browser responses were mocked.

The browser uses the existing seeded test identity at `@test-base`. It uploads `apps/web-e2e/fixtures/fixture-b.jpg` through the picture dialog. No direct database or object-store fixture writes were needed. The recording demonstrates the ordinary Profile and picture lifecycle. Authorization, Handle deadlines, import fencing, crash recovery, quarantine, cancellation and privacy failures are covered by capability, real-adapter and production-composition tests.

## Picture and event verification

The recorded upload created `pic_01M3FJCEC4F94EHRKJXNBVVR7F`. Media returned HTTP 200, `image/webp`, and `Cache-Control: public, max-age=31536000, immutable`. Sharp in the same production container decoded the response as 1600×900, 6,406 bytes, with no EXIF or ICC metadata. These values match the durable asset record.

Response SHA-256: `0c5690eda8627d60fbc8a91974651038639675584b25c3547adcef952b23a6c6`.

The four recorded changes advanced Profile versions from 5 to 9. Their outbox rows contain complete Profile snapshots, the expected display-name, Biography and picture change types, and originating trace context. All four rows were marked published after dispatch. The public Profile showed the saved name, Biography and uploaded picture.

Removal cleared the Profile's picture reference and retired the asset with an expiry exactly thirty days after retirement. A fresh Media request then returned 404 with `application/problem+json` and `Cache-Control: no-store`. This checks fresh origin-authorized delivery; it does not claim to recall previously cached immutable bytes.

## Validation and artifact identity

Final local `make ci` passed 73 build/check/unit/integration tasks and 10 E2E/dependency tasks in 107 seconds. User passes 257 tests across 29 files, and zero of 203 measured functions exceed CRAP 30. After replacing the local User container with the production image, the uncached browser suite passed all three tests in 7.1 seconds. The [migration plan](../../plans/user-effect-migration.md) records the environment adjustments and regression checks. Independent third-round Standards, Spec and in-depth reviews report zero remaining findings.

The recording used production image `sha256:eea637c629b67267ef651f21ea010d7438eb75f9565e9cb61744905ffc2f3a5d`. It runs as the non-root service user, includes the complete emitted application and native encoder, and reports healthy worker, telemetry, broker and database checks.

Recording SHA-256: `0276feec572fa5f8834648c0dc6de65145d3cd154ea92b86652aa5c51c311db2`.
