# Event contract review browser evidence

These short recordings show agent-browser checks against the local stack started with `make infra-start` and `make dev`. They contain test data and complement the deployed Playwright regressions in `apps/web-e2e/specs`.

- [Upload notification](upload-notification.webm): completed upload and duplicate counts survive navigation to Browse; the notification returns to the intact upload queue.
- [Catalogue filter](catalogue-filter.webm): the `#336699` color preference and PNG filter update the visible catalogue.
- [Variant dimensions](variant-dimensions.webm): select the 853×480 variant and open its details with the keyboard. Browser inspection also checked the decoded image dimensions; the video alone cannot prove its pixel dimensions.
- [Profile picture removal](profile-picture-removal.webm): start with the successfully uploaded picture, confirm removal, and return to the original generated avatar. Idle confirmation time is trimmed and the final frame is held briefly. Separate anonymous browser requests verified public delivery before removal and 404 with `Cache-Control: no-store` afterward; no browser page errors were recorded.

The regression tests create fresh uploads, wait for their public projections, and verify actual image decoding. The Profile journey uses a disposable Clerk test owner and checks removal from an anonymous browser. Temporary fault injection made the new journeys fail on incorrect variant pixels and a still-accessible retired picture; those fault hooks were removed before the passing runs and are absent from the committed tests.
