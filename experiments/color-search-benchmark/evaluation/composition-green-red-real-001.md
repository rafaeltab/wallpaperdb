# Natural-image follow-up: 50% green, 50% red

Status: **user judged**, 2026-09-17. **D > A > B > C.** Related development evidence for `composition-green-red-001`.

[Open review](http://zerotwo:8221/evaluation/composition-green-red-real-001.html) · [Machine-readable record](composition-green-red-real-001.json)

## Purpose

The user ranked the constructed color bands **B > D > E > F > A > C**, but questioned whether that order reflects preferences for real wallpapers, especially whether the extra-color A would really rank below the amount-mismatch E. Preserve that fixture judgment and its explicit transfer caveat.

This follow-up keeps the query **50% green, 50% red**, with no exact shades or subject constraint. It shows four natural photographs without claimed or measured color percentages. Before judgment, none was assigned a correct composition or relevance label. The user has now supplied the assessments below.

## User judgments

**D > A > B > C**, with no explicit ties or numerical score gaps.

| Label | User assessment | Recorded distinction |
| --- | --- | --- |
| A | Feels nicely 'red and green', but there is not enough red | Positive color-combination impression; red amount falls short. |
| B | The red isn't strong enough | Insufficient perceived red strength; no separate amount estimate or physical cause supplied. |
| C | This is not what I am looking for with this search | Explicit query mismatch, beyond merely ranking last; no reason or hard filtering rule supplied. |
| D | Really good, would need brighter red and green to feel perfect | Positive reference with an explicit brightness limitation; not a perfect match. |

No exact perceived coverage, saturation threshold, numerical relevance grade or universal brightness preference follows. D's positive assessment does not establish exact 50/50 area. C's mismatch does not establish a blue veto, a general rejection threshold or a hard eligibility exclusion. Different scenes and labels mean this order neither settles nor overturns the stripe A/E tradeoff.

### Raw response

> A Feels nicely 'red and green', but there is not enough red
> B The red isn't strong enough
> C This is not what I am looking for with this search
> D Really good, would need brighter red and green to feel perfect
>
> D, A, B, C

## Presentation

- Four photographs with a one-time random label mapping, recorded in JSON and stable on refresh.
- Complete source images, unchanged bytes, displayed with `object-fit: contain`; no local recoloring or crop. Equal frames on a neutral page.
- Candidate proportions, shade codes, metrics and anticipated relevance are hidden. The requested query percentages remain visible.
- Images open at full size; source and license attribution is available below the sheet.
- The photographs differ in subjects, texture, lighting and composition. They are not controlled variants, and they do not isolate a causal penalty for blue or recreate the stripe A/E comparison exactly.

## Evidence handling

Record the response verbatim before interpreting it. Separate whole-image preference, perceived amount and quality descriptions. Do not infer measured pixel areas, numeric scores or absolute rejection from a rank. Earlier red judgments of a reused image do not determine its relevance to this new query.

Keep this case and the constructed composition cases in the same development group. Source overlap with other development cases must also be accounted for in any later split; this is not held-out evidence. Algorithm selection, implementation, benchmarks and OpenSearch index changes remain deferred.

The previously authorized partial-composition stripe query remains deferred while addressing realism. This is an assistant workflow adjustment in response to the user's concern, not an explicit user cancellation. The next [natural-photo review](composition-green-red-real-002.md) uses these same photographs for 40% green / 40% red with the remainder unspecified and a fresh label mapping. It awaits a separate judgment; this case's order does not transfer.

## Sources and storage

The existing `wallpaper-082` and three newly sourced photographs are identified with hashes, source URLs, author/license metadata and their display labels in the JSON record. Original files live in the [shared library](../CORPUS-STORAGE.md), with hard links preserving the current review URLs. The historical 100-wallpaper corpus manifest and indexes are unchanged.
