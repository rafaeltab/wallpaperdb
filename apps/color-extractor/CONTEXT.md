# Wallpaper color extraction

This context describes the color distribution of an uploaded wallpaper for discovery.

## Language

**Color anchor**:
A reference color whose matching neighborhood can overlap those of other anchors.

**Color measurements**:
A wallpaper's matching area and conditional mean match quality for each color anchor and named target. Measurements describe the original image with transparency composited onto black, independently of a requested search proportion or quality preference.
_Avoid_: Utility, relevance score

**Coverage**:
The fraction of the wallpaper admitted to a target's matching neighborhood. Coverage across overlapping neighborhoods does not form an exclusive palette.

**Conditional mean quality**:
The average match quality among admitted pixels, or zero when no pixels match.

**Named target**:
A hand-authored color family or visual property. Monochromatic and rainbow describe distribution strength rather than physical pixel area.

**Color extraction**:
Measuring colors in an immutable original still image and announcing the completed measurements. Video uploads do not receive color measurements. A fully transparent image has the measurements of black.
