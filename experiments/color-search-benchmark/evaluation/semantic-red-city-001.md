# semantic-red-city-001 — city subject with a red feel

Status: **user judged**, case version 2. Development anchor; conditional ordering and subject eligibility recorded separately.

[Open the four-image review](http://zerotwo:8221/evaluation/semantic-red-city-001.html) · [Structured record](semantic-red-city-001.json)

## Request

**“A city wallpaper with a red feel.”**

No color percentage or precise shade is specified. The initial prompt left the subject-filter mechanics open. The user's response interprets this case as requiring a matching city tag, then ordering eligible images by fit. This does not decide how every natural-language subject request should behave.

## Review

For each example, describe its fit; distinguish subject and color if useful. Identify any images that should not appear at all, and order the remaining examples. Ties, uncertainty and free descriptions are welcome. No required numeric scale.

| Label | Stable image ID | Original | Dimensions |
| --- | --- | --- | --- |
| A | wallpaper-022 | [Image](../corpus/wallpaper-022.jpg) | 6512 × 4341 |
| B | wallpaper-082 | [Image](../corpus/wallpaper-082.jpg) | 6000 × 4000 |
| C | wallpaper-027 | [Image](../corpus/wallpaper-027.png) | 4579 × 2616 |
| D | wallpaper-029 | [Image](../corpus/wallpaper-029.jpg) | 4423 × 2975 |

Whole-image JPEG previews are displayed at consistent sizes on a neutral background, with links to originals. Images are unchanged. Letters are local to this case and do not encode a ranking. Source URLs, revision and original hashes are pinned in the JSON.

## Selection and interpretation boundaries

The four existing corpus images were visually selected to compare urban scenes with different red appearances and a different subject. These are sampling considerations, not user judgments. No subject tags have been verified or assigned. Filenames and repository folders are not a source of eligibility ground truth.

Keep eligibility separate from relative ranking: lower rank does not automatically mean exclusion. Here the user excludes B despite its red match because it is not a city. Earlier judgments of these images for other queries do not define their relevance here.

All four images have appeared in earlier development reviews. This case is related evidence, not an independent held-out sample. No methods, scores or source titles are shown on the review sheet.

## User judgments

**Confirmed order, assuming C matches the city tag: C > D > A. B is excluded.**

| Label | Subject eligibility | Color observation |
| --- | --- | --- |
| A | City matches unequivocally | Weak red match from car lights |
| B | Excluded: not a city | Matches red |
| C | Conditional: must match the city tag | Has a red vibe for sure |
| D | City matches | Red sign; stronger than A, but still weak |

C could be a village or a less tall part of a city. The user would accept the author's identification as a village; we have not verified C's actual location or tags. This comment does not establish a general rule for resolving all metadata disputes.

A's “city 100%” describes an unequivocal subject match, not measured city area or a calibrated confidence score. B is excluded rather than ranked last. A and D's weak color matches remain eligible in this comparison. No red-only ordering involving B, numerical grades, minimum red amount or general weighting formula was supplied.

### Raw response

> A city 100%, and there is some car lights that are red - city matches, red matches weakly
> B that's not a city, but it is red - city doesn't match so would be excluded, red matches
> C thats either a village or a less tall part of a city, and it has a red vibe for sure - city might match (if the author says its a village, then its a village), red matches
> D this is a city, and it has a red sign - city matches red matches less weakly, but still weakly
>
> Assuming C matches 'city' tag ranking would be:
>
> C, D, A with B excluded


## Preparation checks

The structured record parses; all four original SHA-256 hashes match the corpus manifest. The page, four previews and four original links returned HTTP 200. The page also returned HTTP 200 through the local tailnet interface. The existing two-column review layout was reused.
