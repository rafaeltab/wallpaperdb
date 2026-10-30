# Biome test rules

This workspace adapts pinned Vitest assertion algorithms to Biome's JavaScript plugin runtime. It preserves the repository's test-quality checks without an ESLint runtime dependency.

## Core capabilities

- Checks assertion validity, expectations in promises, awaited polling, and test retries.
- Integrates with the shared [test lint configuration](test-correctness.json) and workspace Make/Turbo tasks.
- Compares diagnostics with pinned upstream fixtures through the real Biome CLI.

## Maintenance constraints

[Ported sources](src/ported) and [fixture provenance](test/upstream-fixtures.json) identify the algorithms and documented exclusions. Compare them before changing semantics. [Upstream license notices](UPSTREAM-LICENSE.txt) must remain with the adapted code. Custom rules report diagnostics without upstream text-based fixes or general type/control-flow analysis.

Keep the CLI and plugin runtime pinned together while JavaScript plugins are in developer preview. Native rule selection belongs in the shared configuration, rather than a second prose inventory.

Node coverage measures direct algorithm contracts but cannot observe Biome's isolated plugin execution. Unmeasured bridge paths retain zero hits for CRAP reporting. CLI fixture success does not establish measured coverage of those paths. See the [algorithm contracts](test/algorithm-contracts.test.mjs) and [integration checks](test/integration.test.mjs) when changing collection or rule registration.
