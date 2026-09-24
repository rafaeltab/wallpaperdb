# Per-portion color ranges: durable work log

## User request and settled semantics

Extend the throwaway prototype for requests such as 70% within a range of red and 30% within a range of black; support separate RGB/HSV/HSL limits and combinations. Explain feasibility at one million and 100 million wallpapers. Earlier exact-total interpretation persists: a single requested 40% region prefers 40% over 80%.

The user refined the initial equal-credit idea: center value 100%, edge 50%. Every shade inside a region still counts fully as area; default graded mode minimizes area error first, then prefers central shades among equally good compositions. Flat hard membership and smooth falloff outside the region remain comparison modes. Region constraints on the same row combine with AND; each image portion can supply only one requested row. Overlapping regions therefore represent a feasible partition into distinct portions, not independent overlapping area percentages. Show raw available region coverage separately from in-range allocated coverage.

OKLab radius .20 is 20 on a scale where black-to-white distance is approximately 100; it is not 20% perceived difference or a universal gamut percentage. RGB/S/L/V limits are absolute channel percentage-point distances. Hue range is a fraction of maximum circular distance: 100%=all hues, 10%=±18 degrees. Hue is undefined for achromatic anchors; require unrestricted hue. “Dark grayscale” (HSL S≤2%, L≤10%) differs from “any dark color” (HSV V≤25%, any H/S).

## Ownership

- Root: `ranges.mjs`, real-image evaluation, Make commands, final findings/readme, integration links.
- UI agent: `ranges.html`, `ranges-ui.mjs`, browser verification.
- Design/audit agent: controlled diagnostics, separate fixtures, mathematical notes.
- Research agent: production scaling analysis with primary documentation citations.

## Plan

- [x] Define semantics and shared module API.
- [x] Implement and verify pure scorer, range conversions, boundaries and overlap conservation.
- [x] Evaluate range queries against the 100 wallpapers and independent pixel membership.
- [x] Build and browser-check range editor on the existing tailnet-accessible server.
- [x] Record measured vs projected production costs and retrieval limitations.
- [x] Save final findings, commands, and limitations.

Preserve all earlier experiment sources/results. New prototype is a separate `ranges.html` route; production services remain untouched. Existing server binds `100.97.42.108:8220` and serves new files without a restart.

## Completion checkpoint — 2026-09-16

- New `ranges.mjs` exports query compilation, palette preparation, membership and preference helpers, plus hard/soft/graded scoring. Graded uses a new independently audited two-cost residual solver; area error has strict priority over center preference. Preference is `2^(-t²)`: center 1, edge .5, outside 0. Unrestricted axis limits of 1 do not influence preference.
- Pure white had a spurious HSL-saturation failure after inverse OKLab conversion. Fixed neutral recognition for channel spread ≤1e-6; regression passes.
- `make color-ranges-diagnose` passes 28 groups, including 300 independent exhaustive and 500 continuous solver comparisons. Maximum objective error is 2.22e-16 primary / 1.11e-16 secondary. Twenty SVG fixtures are separate from the 100 real wallpapers.
- UI at http://zerotwo:8220/ranges.html (direct IP 100.97.42.108): default graded vs flat, optional soft outside, seven presets, up to ten portions, two AND constraints per portion, area estimates and conserved assignments, hue/neutral validation, shareable URL, mobile controls. Original proportions page gained a link to ranges. Browser report and screenshots saved; no functional blocker, axe reported zero violations.
- Final formatted-source evaluation: seven actual presets, 100 wallpapers, 32/128 palettes, separate 256-side pixel reference plus exact approximately 10k palette-input pixel reference. Graded32 mean region-area error: .771965 percentage points vs larger sample, .633497 points vs palette input. Graded32 top-ten overlap with 128 is 82.857%; distinguish this from the original 97.5% point-color metric.
- **Critical outlier:** wallpaper-088 / all-gray S≤2%: 32 and 128 palettes report 0% accepted, exact palette-input pixels 34.999%, larger pixels 37.638%. Main error is clustering. Do not claim the 32-color palette is accurate for arbitrarily tight regions, or that 128 fixes this. Finer pixel verification or descriptor uncertainty is needed.
- Local prepared 100-document scoring/sorting medians: flat about 1.0–2.0 ms, graded about 1.4–7.9 ms. Center preference adds modest absolute candidate cost. No 1M/100M benchmark performed. Candidate retrieval quality and boundary verification remain unvalidated production work.
- `RANGES-README.md`, `RANGES-FINDINGS.md`, `RANGES-DESIGN.md`, `RANGES-EVALUATION.md`, `RANGES-SCALING.md`, and `RANGES-BROWSER-CHECK.md` preserve instructions, evidence, and limits. Machine results are in `ranges-evaluation.json`; regenerable pixel cache and browser images are ignored under `output/`.
- No production service/index/event changes, uploads, commits, or publication. Existing tailnet server continues running.
