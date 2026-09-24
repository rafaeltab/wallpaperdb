# Red follow-up: pagoda versus orange sky

Recorded 2026-09-21. [Structured case](perceived-red-pagoda-001.json).

## Human preference

For the ongoing red query, the user prefers **`madness-wallhaven-ogg7ql` (pagoda) over `wallpaper-031` (orange sky)**. This records one pair, without a required score difference or final rank.

The user initially said hue should “influence slightly less”, then clarified: **“as in hue has to be more similar to count, is what I am trying to say.”** The clarification controls the interpretation: tighter hue similarity is desired. It does not specify a numerical hue tolerance or a new scoring formula.

The executable query uses `#FF0000`, inferred from the ongoing conversation. The latest feedback does not repeat the hex value or request a percentage. This assumption is explicit in the JSON.

## Reported behavior and limitations

The user reports ranks **93 for the red pagoda and 61 for the orange image**, and says quality influence 3× can reverse them while harming other results. Exact settings for those ranks were not supplied. These are reported observations; machine replays under known settings remain separate experiment evidence.

The attachment reference positions and “first/second” wording are ambiguous. The recorded preference follows the descriptions “most red” versus “orange” and verified image content, rather than treating inline attachment order as authoritative.

This is a user-selected failure from visible search results. It is **not blind, random, independent, or held out**. No numeric relevance grade, confidence weight, amount estimate, absolute acceptability label, universal hue rule, or ordering against other images is inferred. Earlier quick-pass caveats remain relevant to the broader development collection, but this separate follow-up was not part of that batch submission.

## Source identity

| Image | Corpus source SHA256 | Identification |
| --- | --- | --- |
| Pagoda `madness-wallhaven-ogg7ql` | `c27b283be1c3fdad1d4660d837410854921e92fb14161f24f6b48285841be5f2` | Source comparison at 64×64 sRGB has zero RGB error. |
| Orange sky `wallpaper-031` | `7ad700c6e4bfb0799eda39221bf0c0738650c5a891056d36956bb46788b8496a` | Source comparison has mean absolute RGB error 0.7686 and RMS error 1.2604 on byte-valued channels. |

The JSON preserves both attachment hashes, original-source hashes, dimensions, source records, identification-report hashes, and verbatim user messages. Source and attachment bytes were checked against their recorded hashes. Images remain in the shared external corpus; no image bytes are added to the repository.

Identification artifacts are in `/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/shade-pair/2026-09-21/`, under `pagoda-identification/` and `orange-sky-identification/`.

## Optional feedback-loop inclusion

The default dataset stays at **37 cases**. Include this record explicitly to evaluate **38 cases**:

```sh
make color-exploration-evaluate COLOR_EXP_ARGS='--methods cutoff-all-levels,cutoff-shade-all-levels --extra-cases evaluation/perceived-red-pagoda-001.json --repeats 3'
```

`--extra-cases` accepts comma-separated paths relative to `experiments/color-search-benchmark/`. The added source is hashed into the dataset snapshot and its selection is retained in run configuration. Duplicate logical case IDs are rejected.

The case uses `evaluationGroup: shade-followup-pagoda`. Report its result separately alongside legacy accuracy; a 38-case aggregate is not directly comparable to historical 37-case aggregates. Existing source-image overlap grouping still joins this case to earlier records containing `wallpaper-031`; adding a case can change those group IDs in the enriched run, without changing earlier judgments or the default dataset.
