# Try the color-query prototypes

Open [the visual browser](http://zerotwo:8225/). It searches **523 wallpapers** by default; the optional **Include 22 controlled test swatches** checkbox adds the evaluation fixtures. Every result column comes from its declared search service, OpenSearch or ClickHouse.

1. Pick a preset under **Start with a query**. **Feels red** compares overall color feeling; **40% green, rest free** aims near 40% total green; **80% grayscale + 20% red** specifies the complete composition.
2. Select methods under **Compare methods**. **Suggested mix** includes the HSV cosine control, refined named features, and a hybrid. Search method names for `L2`, `palette`, `hybrid`, or `typed`; **Expand families** reveals every registered method. Searching method names preserves existing selections.
3. Click **Compare selected** at the top. Columns keep the service's returned order. Scroll sideways between columns, and click any image to inspect the uncropped original.
4. Open **Method notes** to see limitations and the executed service query's evidence. **Exact for this score** means global ordering under that stored score; **Approximate retrieval** can miss better-scoring results. Unsupported controls are reported explicitly.

## Queries worth exploring

| Intent | Controls |
| --- | --- |
| A red feeling | **Feels red**, then compare HSV cosine, raw L2, and refined or hybrid methods. |
| Close to 40% green | **40% green, rest free**. The remaining 60% is unspecified; an 80%-green image can still miss the requested amount. |
| Grayscale with red accents | Compare **80% grayscale + 20% red** with **80% grayscale + 10% red, rest free**. The latter leaves 10% unspecified. |
| Broad red and dark regions | **70% reddish + 30% dark** uses explicit perceptual ranges. Adjust each target's **Color range and falloff**. |
| Dark, nearly grayscale | **Dark grayscale · HSL range** uses black with hue distance 100%, saturation distance 2%, and lightness distance 10%. |
| A specific shade | **Picked orange-red · method defaults** uses a plain picked color. **Precise orange-red** adds an adjustable OKLab range. Compare direct palette and indexed precision methods. |
| Dark background with bright details | **Dark with bright spots** exercises the relative-contrast hybrid. |

For custom ranges, enable **Use a custom range around this color**, then choose OKLab, RGB, HSV, or HSL. The center has full value; the default edge has 50% value. A vector method with a fixed query shape may report this query as unsupported. A picked color without a custom range uses each method's default color-distance model.

**Copy this query** shares the targets, selected methods, and fixture setting. Trying queries does not modify the recorded human judgments.

To try the alternative service, choose **Precise orange-red**, search method names for `ClickHouse`, select its single palette-precision method, and click **Compare selected**. It ranks and filters in ClickHouse itself over the same complete corpus. Compare it with OpenSearch's typed or precomputed precision methods. The ClickHouse prototype currently supports one picked hex in vibe mode with an OKLab range.

To try the indexed color grid, choose **Picked orange-red · method defaults**, search for `picked-color grid`, and select **Native indexed picked-color grid** under **Indexed color features**. Its **Interpolated color score · global indexed ranking** badge distinguishes the approximate color formula from OpenSearch's global ranking. It supports one picked hex with fixed default distance/falloff; enabling a custom range or proportions returns an explicit unsupported response. Compare with **Direct picked-color precision, typed Painless** to inspect where interpolation changes the result order.

Read [Latest findings](http://zerotwo:8225/findings) for saved accuracy results, coverage differences, and scale measurements. Live browser latency covers this small corpus and current load; use those saved benchmarks to judge million-wallpaper performance.
