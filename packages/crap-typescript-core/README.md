# CRAP analyzer

This private workspace supplies the TypeScript analyzer used by WallpaperDB's CRAP reports. It maintains an upstream copy with callback discovery and coverage attribution fixes so they can mature in repository use before an upstream contribution.

## Capabilities

- Finds functions and callbacks, including async functions, generators, and curried wrappers, and measures each body's complexity independently.
- Attributes statement and branch coverage to the function that owns the source body, keeping incomplete measurements unknown.
- Calculates CRAP scores from complexity and coverage.

The package owns analysis. The [repository command](../../scripts/crap.mts) owns workspace selection, coverage collection, thresholds, and missing-coverage policy. Consumers use the package's [public entry point](src/index.ts).

Tests and type checking participate in the standard workspace tasks through Turbo. See the [package scripts](package.json) and [shared Make commands](../../Makefile) for available checks. The [CRAP guide](../../apps/docs/content/docs/guides/crap-scores.mdx) explains report interpretation and coverage limitations.

See [UPSTREAM.md](UPSTREAM.md) for provenance, local maintenance rules, and the contribution follow-up. The imported code retains its [Apache-2.0 license](LICENSE).
