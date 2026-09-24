# Color ranges and proportions — interactive prototype

Explore requests such as **70% reddish colors plus 30% dark colors**, or **70% dark grayscale**. Each requested portion has its own color range, and acceptable shades closer to its center receive a stronger preference. This is a separate throwaway experiment; earlier proportion and cosine/L2 results are preserved.

## Open or run

Current tailnet route: **http://zerotwo:8220/ranges.html**. Direct-IP fallback: **http://100.97.42.108:8220/ranges.html**.

From the repository root:

```sh
make color-ranges-serve
```

Open http://localhost:8220/ranges.html. To serve on this machine's Tailscale address:

```sh
COLOR_PROPORTIONS_HOST="$(tailscale ip -4)" make color-ranges-serve
```

The command prepares the same 100 real wallpaper palettes, verifies controlled cases, and starts or reuses the static prototype server. It also serves the previous `/proportions.html` and `/report.html` pages. Keep the server process running.

## Controls

- **Image percentage:** an absolute portion of the whole image. Partial requests leave a remainder. Default matching aims for the requested total, penalizing excess as well as shortage.
- **Anchor:** the color around which the range is defined.
- **OKLab radius:** perceptual-coordinate distance. Radius 20 in the editor means `.20` OKLab; black-to-white spans approximately 100 editor units. It is not a calibrated 20% visual difference or 20% of the gamut.
- **RGB:** independent tolerances for encoded red, green, and blue channels.
- **HSL:** hue, saturation, and lightness tolerances. Black with unrestricted hue, saturation ±2 points, and lightness ±10 points gives dark grayscale.
- **HSV:** hue, saturation, and value tolerances. Black with unrestricted hue and saturation, value ±25 points, gives dark colors including saturated blue, green, and red.
- **AND constraint:** optionally constrain the same portion in a second color space. A shade must satisfy both. The scorer supports up to four distinct spaces; the editor exposes two constraints per portion.

RGB, saturation, lightness, and value limits use absolute percentage points. Hue uses the shortest circular distance; the editor shows degrees, with ±180° meaning all hues. Black/gray/white have no meaningful hue, so their hue control must be unrestricted. A 100-point channel tolerance is unrestricted and also contributes no center preference.

There are up to ten portions, seven presets, real-wallpaper and controlled-example datasets, and a shareable query URL. Twenty synthetic fixtures have known analytic areas and are explicitly separate from the real-image corpus.

## Center preference without changing area

The default **graded** mode ranks by two priorities:

1. Match the requested image percentages as closely as possible.
2. Among equal proportion matches, prefer shades closer to the range center.

Center preference is `2^(-t²)`, where `t=0` is the center and `t=1` is the edge. That gives **100% at the center and 50% at the boundary**. A 70% portion at the edge still counts as 70% image area; it receives a weaker color preference. Outside shades get no accepted area or graded preference. Unrestricted axes are ignored, so an “any hue/saturation, dark value” query only prefers lower value.

Compare with **hard membership**, where every accepted shade counts equally, or **soft outside**, which keeps full preference inside and gradually accepts neighboring shades outside. The latter is an alternative smooth objective; it does not implement the default center preference.

## Reading results

**Available** estimates all image area in each region independently. Regions may overlap, so those columns may sum above 100%. **Allocated in range** is accepted area actually assigned to each distinct requested portion; it cannot double-count the same image area. Zero area error means the requested partition is possible. Assignments do not describe spatial regions.

The default sorts by area error first, then color preference. A correct 70% portion near the boundary beats 65% of the exact center color. Areas are palette estimates; narrow boundaries can cut through a palette cluster. The source-pixel evaluation records outliers that a good average would otherwise hide.

## Reproduce and inspect

```sh
make color-ranges-diagnose   # controlled semantics and independent solver audit
make color-ranges-evaluate   # seven presets × 100 images, pixel references, timings
make color-ranges-format    # only this prototype's new source files
```

- [Findings](RANGES-FINDINGS.md)
- [Full evaluation](RANGES-EVALUATION.md) and [saved rankings](ranges-evaluation.json)
- [Production scaling analysis](RANGES-SCALING.md)
- [Design and audit](RANGES-DESIGN.md)
- [Browser checks](RANGES-BROWSER-CHECK.md)
- [Durable work log](RANGES-WORKLOG.md)

`ranges.mjs` contains pure query/descriptor preparation, membership, center preference, and ranking functions. Graded mode uses a transport solver that prioritizes area error before color cost. No production search fields, services, events, or API contracts are changed.
