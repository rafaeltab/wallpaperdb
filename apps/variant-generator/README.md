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

The [unit selection](vitest.config.ts) covers capability decisions through controlled ports, configuration and protocol translation without production image or telemetry resources. The [integration selection](vitest.integration.config.ts) runs two ordered projects in one coverage report:

- `.runtime.integration.test.ts` covers native image/process ownership, telemetry lifecycle and builds with two isolated workers.
- Other `.integration.test.ts` files run container and application contracts serially afterward.

Assign each scenario to exactly one selection. Distinct nonzero [sequence group orders](https://vitest.dev/config/sequence#sequence-grouporder) avoid dependence on project-name sorting and Vitest 5's default-group handling of isolated one-worker files. Inline projects inherit root options, including file isolation; SDK patches and telemetry globals require that isolation.

Preserve the cancellation fixture's 1,200 ms response delay, telemetry collector stall and native kill/reap assertions. Virtual deadlines do not exercise those cleanup paths. [Package scripts](package.json) produce complementary coverage of the same sources for the [repository merge](../../package.json); the [complete selection](vitest.all.config.ts) provides a single serial run.
