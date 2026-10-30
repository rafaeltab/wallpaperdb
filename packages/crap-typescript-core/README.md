# CRAP analyzer

This package analyzes TypeScript and maintained `.js` sources for WallpaperDB's CRAP reports.

- Measures complexity for functions and callbacks, including async functions, generators, and curried wrappers.
- Attributes statement and branch coverage to the owning function, keeping incomplete measurements unknown.
- Calculates CRAP scores from complexity and coverage.

The [public entry point](src/index.ts) exposes analysis. The [repository command](../../scripts/crap.mts) owns workspace selection, coverage collection, thresholds, and missing-coverage policy. See the [CRAP guide](../../apps/docs/content/docs/guides/crap-scores.mdx) for report interpretation and coverage limitations.

[UPSTREAM.md](UPSTREAM.md) records provenance, maintenance rules, and the contribution follow-up. Imported code retains its [Apache-2.0 license](LICENSE).
