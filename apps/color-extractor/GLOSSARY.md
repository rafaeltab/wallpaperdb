# Wallpaper color extraction

This context describes the color distribution of an uploaded wallpaper for discovery.

## Language

**Color anchor**:
A reference color whose matching neighborhood can overlap those of other anchors.

**Color measurements**:
A wallpaper's matching area and conditional mean match quality for each color anchor and named target. Measurements describe its Color measurement Source with transparency composited onto black, independently of a requested search proportion or quality preference.
_Avoid_: Utility, relevance score

**Color measurement Source**:
The first Source designated as a Wallpaper Asset's Default Source, used as the stable reference for its color measurements. Later default changes, Source replacements or withdrawals do not automatically reselect it or replace the recorded measurements.

**Measurement provenance**:
The Wallpaper Asset, initial Color measurement Source and analysis version to which recorded color measurements belong. Their provenance and measurements remain stable across later default changes, Source replacements and withdrawals.

**Coverage**:
The fraction of the wallpaper admitted to a target's matching neighborhood. Coverage across overlapping neighborhoods does not form an exclusive palette.

**Conditional mean quality**:
The average match quality among admitted pixels, or zero when no pixels match.

**Named target**:
A hand-authored color family or visual property. Monochromatic and rainbow describe distribution strength rather than physical pixel area.

**Color extraction**:
Measuring colors in an immutable Color measurement Source under the still-image policy and announcing the completed measurements. Video uploads do not receive color measurements; a fully transparent image has the measurements of black.
