# Variant generator

Variant Generator creates lower-resolution renditions of uploaded wallpapers so clients can retrieve images suited to their devices. It preserves the immutable original and announces stored variants for Asset to deliver.

## Core capabilities

- Selects smaller resolution presets for standard, ultrawide, and phone aspect ratios, without enlarging images.
- Preserves image proportions and the supported source format while applying configured encoding quality.
- Announces exact encoded dimensions for new renditions while keeping preset-based asset and event identities stable.
- Stores and announces each variant before treating it as complete.
- Continues other presets after an individual failure, then retries incomplete batches while preserving already stored variants and their recorded metadata.
- Skips videos and images without applicable presets, and quarantines requests that cannot complete after retries with their original bytes and CloudEvent metadata.

Sharp resizes and encodes images in an isolated process so deadlines and shutdown can stop native work. Object storage holds the originals and variants; NATS JetStream retains generation requests and variant announcements.

See the [domain context](GLOSSARY.md), [replay decision](docs/adr/0001-replay-safe-variant-generation.md), [upgrade and replay procedures](../docs/content/docs/guides/service-upgrades.mdx), and [contributor setup](../../CONTRIBUTING.md).

## Test boundaries

The [unit selection](vitest.config.ts) keeps capability decisions behind controlled driven ports, configuration parsing, and protocol translation without starting production image or telemetry resources. The [integration selection](vitest.integration.config.ts) runs two ordered projects in one invocation and coverage report. `.runtime.integration.test.ts` files cover native image/process ownership, telemetry SDK lifecycle and artifact builds with two isolated workers. Other `.integration.test.ts` files cover container and application composition contracts serially after the runtime group. Keep new scenarios in exactly one selection using these suffixes.

Vitest 5 uses each project's worker budget for its [sequence group](https://vitest.dev/config/sequence#sequence-grouporder). Distinct, nonzero group orders keep runtime overlap and container serialization independent of project-name sorting or the special handling of isolated one-worker files at the default group order. Inline projects inherit the root options in Vitest 5, including per-file isolation; the runtime project overrides only its selection and execution policy. The unchanged scripts and coverage destination keep both slower groups in the existing Make/Turbo integration task.

Both selections retain per-file isolation. SDK patches and telemetry globals must not reuse modules across files. The cancellation fixture's deliberate 1,200 ms response delay and the telemetry collector stall exercise real resource cleanup; virtual application deadlines do not replace those stimuli or native kill/reap assertions. See the [package scripts](package.json) for coverage-producing selections and the [complete selection](vitest.all.config.ts) for a single serial run. Unit and integration coverage include the same production sources and write complementary reports for the repository's [coverage merge](../../package.json).
