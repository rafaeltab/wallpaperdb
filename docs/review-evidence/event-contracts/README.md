# Event contract review browser evidence

These short recordings show agent-browser checks against the local stack started with `make infra-start` and `make dev`. They contain test data and complement the deployed Playwright regressions in `apps/web-e2e/specs`.

- [Upload notification](upload-notification.webm): completed upload and duplicate counts survive navigation to Browse; the notification returns to the intact upload queue.
- [Catalogue filter](catalogue-filter.webm): the `#336699` color preference and PNG filter update the visible catalogue.
- [Variant dimensions](variant-dimensions.webm): select the 853×480 variant and open its details with the keyboard. Browser inspection also checked the decoded image dimensions; the video alone cannot prove its pixel dimensions.
- [Profile picture removal](profile-picture-removal.webm): start with the successfully uploaded picture, confirm removal, and return to the original generated avatar. Idle confirmation time is trimmed and the final frame is held briefly. Separate anonymous browser requests verified public delivery before removal and 404 with `Cache-Control: no-store` afterward; no browser page errors were recorded.

The regression tests create fresh uploads, wait for their public projections, and verify actual image decoding. The Profile journey uses a disposable Clerk test owner and checks removal from an anonymous browser. Temporary fault injection made the new journeys fail on incorrect variant pixels and a still-accessible retired picture; those fault hooks were removed before the passing runs and are absent from the committed tests.

## Stable asset layout verification

These additional checks exercised fresh assets after removing descriptor storage. The existing descriptor count remained at 50 after the new wallpaper and Profile-picture uploads. Existing object paths and data were preserved.

- [Duplicate upload completes](deterministic-upload.mp4) shows a second upload of the verified fresh fixture reaching Upload complete, 100%, and one duplicate. The original upload returned 200 and its new ID reached catalogue and color results.
- [Variant selection](deterministic-variant.mp4) shows the new wallpaper changing from its 1280×720 original to the 853×480 rendition. Separate browser decoding confirmed exactly 853×480 pixels.
- [Profile picture lifecycle](deterministic-profile.mp4) shows the saved picture, removal confirmation, and restored generated avatar. Anonymous browser requests returned 200 before removal and 404 with `Cache-Control: no-store` afterward.
- [Settled catalogue filter](deterministic-filter.png) shows the #336699 preference and PNG filter. The exact new wallpaper ID was also found in the public color-ranked response.

The duplicate-upload clip runs in real time. Fast variant and Profile actions are slowed and final frames held for readability; these clips are not performance measurements. The Profile clip omits a development reload between upload and removal. It shows the same saved picture and its completed removal. Final page-error checks were empty, and the original Profile state was restored.
