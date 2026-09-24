# Blind visual review of final contact sheets

Recorded 2026-09-15, before revealing the method key.

This is one model's visual sanity review, **not human relevance ground truth**. I viewed all eight final `output/blind/*.png` sheets using the image viewer. I did not read the method key, benchmark results, or algorithm implementation during this review. I had previously audited the production pipeline; I did not know which method generated any column. An earlier version of the eight sheets was viewed before the coordinator announced an implementation fix; all eight regenerated final sheets were viewed again before recording these judgments.

## Criteria

- A convincing match has a substantial visible region reasonably close to the displayed target swatch. A tiny accent, generic darkness, or a vaguely related color family is insufficient.
- Counts below are conservative visual judgments, not measured pixel percentages or exact color thresholds. Borderline and nearest-available results are discussed separately.
- The black/red sheet requires substantial regions of **both** colors. Merely containing a few red details against a dark background does not pass.
- Preference considers closeness and rank order as well as the count. Columns can have equal convincing counts while one puts the useful result earlier and has better fallbacks.
- Letter identities are local to each sheet. Do not combine letter totals as if a letter necessarily denotes one method.

## Recorded judgments

| Sheet / target | Preferred column | A: convincing / 5 | B: convincing / 5 | C: convincing / 5 |
| --- | --- | ---: | ---: | ---: |
| Orange `#FF8000` | **A** | 3 | 1 | 1 |
| Teal `#008080` | **C** | 1 | 1 | 5 |
| Sky `#60BFFF` | **C**, with weak remaining matches | 0 | 1 | 1 |
| Navy `#102040` | **C** | 0 | 1 | 2 |
| Magenta `#FF00FF` | **None convincing**; C is the best fallback order | 0 | 0 | 0 |
| Rose `#C06070` | **B**, though its best match ranks fifth | 0 | 2 | 0 |
| Cream `#FFF0C0` | **C** | 1 | 0 | 3 |
| Black/red `#101010` + `#FF3030` | **A**, though its first result is weaker than ranks 2–3 | 2 | 1 | 1 |

## Sheet observations

### Orange — A

Convincing ranks: A **1, 3, 5**; B **3**; C **5**.

A leads with the orange sunset (`wallpaper-037`) and also returns the orange-cloud landscape (`031`) and autumn painting (`094`). These display broad orange regions. The peach/coral islands (`058`, A2/B1) are a plausible, less saturated fallback; I did not count them as a firm match to this bright orange swatch. The flowers (`049`) read mainly pale ochre/yellow rather than orange.

B's autumn painting is useful but its fourth result is monochrome and its fifth is a pastel abstract. C begins with two monochrome images, followed by a predominantly pink/purple sunset and a muted green painting. Those are clear relevance failures for this target.

### Teal — C

Convincing ranks: A **4**; B **1**; C **1–5**.

C consistently shows substantial blue-green areas: the tower's flat background (`030`), coastal water (`024`), the darker water above the rocky shoreline (`013`), the swimming pool (`098`), and the teal/mint swirl design (`004`). The shades vary, with the pool lighter and shoreline darker, but the requested color remains a strong visual component.

A's canyon illustration (`040`) has a useful teal sky. Its bamboo, pink sunset, monochrome scene and koi pond do not offer similarly clear teal coverage. B's pool is convincing, but the airplane sky is bluer, the architecture sky is desaturated blue, the stream scene is mostly very light cyan/white, and the lily pond is predominantly green/dark. Those last options are weaker fallbacks rather than firm matches.

### Sky — C, but only one firm match

Convincing ranks: A **none**; B **4**; C **1**.

The blue sky through arches (`028`) is the clearest substantial match, at C1 and B4. C then stays in a broadly relevant pale/cool-blue neighborhood: blue-tinted snow (`014`), a pale mountain sky (`072`), muted blue/lavender sky behind architecture (`021`), and a cyan-to-pink sky over rocks (`087`). However, these are weaker than the bright, relatively saturated swatch. I did not count a snow color cast or an approximate sky gradient as a firm match.

B hides the clear match at rank four and leads with monochrome, pastel pink, and coral/teal images. Its last gradient landscape (`056`) is a plausible subdued fallback. A's first two results are monochrome; the remaining results are dominated by other colors. C improves the ordering substantially, but this sheet does **not** establish five strong sky-blue matches.

### Navy — C

Convincing ranks: A **none**; B **3**; C **1, 5**.

C1 (`008`) has a large, nearly uniform deep-blue background and is the strongest match on the sheet. C5 (`015`) has substantial dark-blue water around the island. C2/C3's cities (`016`, `022`) are useful dark/cool fallbacks but lean toward charcoal/teal, and C4 (`067`) is a black/gray rock image.

B3's canyon (`040`) contains substantial navy/purple shadow regions, although the overall image is strongly teal and orange too. A's dark city is gray, its flowers contain brighter blue accents, and its other images read brown, green or teal. Generic darkness alone did not qualify them as navy.

### Magenta — no convincing match; C is the best fallback order

Convincing ranks: **none in any column**.

The purple scene with a bright pink/magenta glow (`033`, C1/A5) is the closest available option among these results, but most of the image is purple/dark purple and the bright region does not give a convincing substantial area of the highly saturated `#FF00FF` target. The other colorful candidates are pink sunsets, violet mountains and lavender skies rather than strong saturated magenta.

C promotes the closest fallback to first place; A puts it last. B ends with two monochrome images, which are clearly inappropriate. The correct conclusion is **better nearest-available ordering**, not successful magenta filtering. These sheets alone cannot establish whether a true magenta match exists elsewhere in the corpus.

### Rose — B, with a serious ordering weakness

Convincing ranks: A **none**; B **2, 5**; C **none**.

B5's rose pattern (`048`) has repeated, substantial dusty-rose areas and is the clearest match. B2's blossoms (`044`) provide substantial warm pink/rose coverage, although many petals are lighter than the target. B's beige first result (`009`), purple landscape and muted interior painting are weak for this specific rose swatch. The best match being fifth is a visible remaining ranking defect.

A1/C1's pink sunset (`038`) and C5's balloon sunset (`039`) are reasonable broader pink-family fallbacks, but look brighter and more purple/pink than the dusty rose target. C also returns orange/coral islands, a purple landscape and autumn colors. A includes two monochrome results. B is preferred for retrieving the most convincing rose-colored images, not for having a strong top result.

### Cream — C

Convincing ranks: A **3**; B **none**; C **1, 2, 4**.

C1 (`060`) offers a large warm off-white/cream background. C2 (`055`) has a broad pale yellow/cream sky, slightly greenish but close enough to be useful. C4/A3 (`010`) has a substantial warm cream facade alongside cyan sky. C3 (`006`) is mostly neutral white, and C5 (`073`) has a pale peach/white sky: reasonable light-background fallbacks, but weaker matches to cream.

A's pastel abstract and orange-island illustration contain some light warm areas but do not read as substantial cream matches. B is dominated by grayscale scenes, pinkish pastels, and a muted green landscape. White or gray brightness by itself should not be mistaken for warm cream.

### Black/red — A

Convincing ranks: A **2, 3**; B **2**; C **1**.

A2 (`082`) combines large red flower/leaf regions with dark foliage; A3 (`027`) combines red-lit ground/storefront areas with dark alley walls. Both requested colors are substantial rather than incidental. The koi pond (`084`, B2/C1) also has a large red-orange structural element against dark water and qualifies, although the red is warmer than the swatch.

A1's sunset (`037`) is dominated by orange/red with a relatively narrow dark strip; I did not count it as a firm two-color match. The canyon (`040`) is predominantly teal/orange with dark colored shadows. The final New York sign (`029`, A5) contains red lettering but the red is an accent, so it fails the substantial-area criterion. B's remaining still life, muted flowers, cabin and forest lack substantial bright red. C's remaining canyon, cabin, bamboo and pink sunset also fail the two-color requirement.

## Conclusions preserved before unblinding

The best anonymous column improves visible relevance clearly in several sheets, especially teal, orange, navy and cream. Improvement is uneven: sky-blue has limited strong results, the best dusty-rose example remains poorly ranked, and no displayed result convincingly satisfies saturated magenta. The two-color sheet exposes the difference between finding an accent and finding substantial areas of both colors.

These judgments should be joined to the method key **after** preserving this document. They support a qualitative sanity check, not a statistically validated preference study or a claim that every requested color has good matches in this 100-image sample.
