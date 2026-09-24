# Color query browser — throwaway prototype

The browser lets a person compare real service-backed search methods on the same shared image corpus. It does not choose a winning method or change the existing human judgments.

Run `make color-exploration-browser`, then open **http://zerotwo:8225/** from the tailnet. The listener defaults to `0.0.0.0:8225` so it is reachable beyond localhost. Override `COLOR_EXPLORATION_HOST` or `COLOR_EXPLORATION_PORT` when needed.

For a short tour and suggested queries, see [the visual walkthrough](browser-WALKTHROUGH.md). Saved results are available through [Latest findings](http://zerotwo:8225/findings).

Choose an overall color vibe or explicit target proportions, add named colors/vibes or precise hex colors, optionally enable RGB/HSV/HSL/OKLab ranges, then select several methods. Queries run sequentially so the browser comparison itself adds less cross-method load. The concurrency benchmarks are separate saved experiments.

The browser searches real wallpapers by default. **Include controlled test swatches** also includes the synthetic evaluation fixtures; this eligibility filter is applied inside the selected search service by the provider.

Each result column preserves the exact order returned by the search service. It shows elapsed service time, available backend timing, retrieval guarantees, limitations, and unsupported controls. A query taking more than one second is highlighted. These live timings describe the current small corpus and machine load; they do not establish million-image performance.

Methods identify their backend explicitly. The ClickHouse precise-color prototype appears under **Other search services** and supports one picked hex color in vibe mode, with an optional OKLab radius. Its result timing is labeled ClickHouse; named colors and proportions are explicitly unsupported. The original OpenSearch methods keep their existing behavior.

The native picked-color grid appears under **Indexed color features**. Use **Picked orange-red · method defaults** to try its fixed precision scope. Its visible **Interpolated color score · global indexed ranking** badge means OpenSearch globally ranks an approximate stored objective; it does not promise the continuous palette formula. Custom ranges and proportions are explicitly unsupported.

Click a wallpaper to inspect its original. **Copy this query** creates a shareable URL containing controls and method IDs. It does not save or modify judgments. Existing feedback reports remain available through the header link.

## Provider contract

`browser-cli.mjs` imports `browser-provider.mjs` beside it, or the absolute/project-relative module path in `COLOR_EXPLORATION_PROVIDER`. The module exports:

```js
export async function createBrowserProvider() {
  return {
    methods: [{ id, label, family, description, limitations, execution }],
    corpus: [{ id, filename, thumbnail }],
    async search({ methodId, query, limit, signal, includeFixtures }) {
      // Compile query and send it to the actual service. No local document ranking.
      return { hits: [{ id, score }], totalEligible, evidence, warnings };
    },
    // Optional: reportUrl, findingsUrl: '/findings', description, presets, close().
    // Optional: async getFindingsHtml() returns a safely escaped, script-free HTML summary.
  };
}
```

The normalized query is `{mode, targets, unspecifiedRemainderPercent?}`. Each target has `color` (six-digit hex), optional `name`, `percent` for proportions, optional `space` and `tolerance`, and `edgeWeight`. A named target omits tolerance unless the user explicitly enables a custom range. Distances and edge weight are fractions from zero to one; percentages use zero to 100.

`createBrowserServer` and `startBrowserServer` are exported from `browser.mjs` for integration. Asset serving uses registered corpus IDs and a fixed static file map, never user-provided filesystem paths. Invalid/unregistered search results fail visibly instead of being silently filtered in the browser server.

Validation: `make color-exploration-browser-test` checks service forwarding, result-order preservation, control validation, explicit unsupported responses, and asset allowlisting.

`browser-smoke.mjs` checks every registered method against the live HTTP API, plus ranges, relative accents, fixture filtering, and image access. Run it through the corresponding Make command; receipts are saved under the external corpus store's `exploration/browser-qa/` directory. These smoke timings are not controlled performance measurements.

Methods are grouped into collapsible families. New visitors initially compare HSV cosine, refined named features, and the relative-contrast hybrid; selecting **All** still runs every registered method, with unsupported queries shown explicitly. The **Exact for this score** badge means global ordering under the stored scoring model, not guaranteed agreement with human perception.

If the provider supplies `getFindingsHtml`, the fixed read-only `/findings` route renders its HTML and enables the optional **Latest findings** header link. Inline CSS is allowed for the report; scripts are disabled. The route never accepts a filename or filesystem path.
