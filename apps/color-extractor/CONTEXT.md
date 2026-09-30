# Wallpaper color extraction

This context describes the color distribution of an uploaded wallpaper for discovery.

## Language

**Color histogram**:
The normalized distribution of a wallpaper's visible colors. Fully transparent pixels contribute nothing.

**Color measurement**:
A description of how much of a wallpaper matches a color target and the quality of those matches, or of a named visual property. A measurement describes the image independently of a requested search proportion or quality preference.
_Avoid_: Utility, relevance score

**Coverage**:
The fraction of a wallpaper's sampled area admitted by a color target's matching threshold. Overlapping targets can measure the same area.

**Conditional quality**:
The average similarity of the area admitted by a color target's matching threshold. It is zero when no area is admitted.

**Color extraction**:
Measuring the color distribution of an immutable original still image for discovery. A color histogram is one description of that distribution; matching-area and quality measurements are another.
