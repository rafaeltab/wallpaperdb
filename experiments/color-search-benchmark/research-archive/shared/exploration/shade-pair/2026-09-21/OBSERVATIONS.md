# Red pagoda versus orange/yellow sky: reproduced regression

2026-09-21. User feedback supplies a strict preference for the red pagoda/moon wallpaper over the orange/yellow sky when querying red. The follow-up clarification asks for hue to be more similar before counting: stricter hue matching. No perceived-area percentages are assigned.

## Identification

- Preferred pagoda: `madness-wallhaven-ogg7ql`, original `corpus/wallpapermadness/wallhaven-ogg7ql.png`. The attachment and original source have identical normalized 64×64 RGB pixels (RMSE 0); visual inspection confirms the pagodas and moon.
- Other orange/yellow sky: `wallpaper-031`, original `corpus/wallpaper-031.jpg`. Source versus attachment RMSE is 1.26/255; next unrelated corpus candidates exceed 59/255. Visual inspection confirms the orange clouds and yellow horizon.

Full attachment/source hashes and comparisons are in `pagoda-identification/identification.json` and `orange-sky-identification/identification.json`.

## Current OpenSearch replay

Method `cutoff-shade-all-levels`, picked `#FF0000`, vibe mode, smooth-power quality, minimum average quality 0. All 523 real images are ranked by OpenSearch; fixtures are excluded by its query. All four banks return the same ranks because this picked red is an exact shared anchor.

| Quality influence | Cutoff weighting | Pagoda rank | Sky rank | Desired strict preference passes |
|---:|---:|---:|---:|---|
| 1 | 0 | 91 | 52 | No |
| 1 | 3 | 101 | 61 | No |
| 1 | 6 | 95 | 81 | No |
| 3 | 0 | 108 | 60 | No |
| 3 | 3 | 100 | 80 | No |
| 3 | 6 | 83 | 92 | Yes |

The reported display ranks were 93 and 61. Exact original controls were not captured, so those precise ranks are not claimed as reproduced. The undesired ordering is reproduced across twenty of the twenty-four tested configurations. Higher quality influence reverses the pair only with the strongest tested cutoff weighting.

## Stored measurements for red

| Quality cutoff | Pagoda admitted area | Pagoda mean quality | Sky admitted area | Sky mean quality |
|---:|---:|---:|---:|---:|
| 0% | 44.93% | 20.45% | 39.23% | 30.25% |
| 25% | 13.84% | 35.65% | 23.35% | 41.62% |
| 50% | 0.99% | 57.83% | 5.68% | 56.53% |
| 75% | 0.02% | 75.79% | 0% | 0% |
| 90% | 0% | 0% | 0% | 0% |

These are the candidate metric's indexed measurements, not human color-area labels. Areas overlap and must not be added. The sky receives more medium-quality area; the pagoda's strictest useful advantage is a tiny 75% component. At influence 1/weighting 3, final scores are 0.021471864 versus 0.033415463, contradicting the user preference.

## Failing regression assertion

```sh
make color-shade-pair-replay COLOR_SHADE_ARGS='--preferred-id madness-wallhaven-ogg7ql --other-id wallpaper-031 --assert-preference --output-directory /home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/shade-pair/2026-09-21/baseline'
```

The underlying script exits 1, and Make exits 2, because 20/24 configurations fail `pagoda.score > sky.score`. This is the expected red diagnostic assertion, not a service failure. All 24 full-corpus searches and 48 document inspections completed; search scores and reconstructed OpenSearch scores agree.

`baseline.log` captures the invocation output. `baseline/pair-replay.json` retains every ordered hit, exact parameters, component ledgers, selected region definitions, source hashes and the explicit desired pair. `baseline/sources.json` preserves the complete query/helper source snapshot.

No existing metric, query formula, index or human dataset was changed during identification and replay. Any proposed stricter-hue measurement must use separate versioned measurements and be compared against this baseline.
