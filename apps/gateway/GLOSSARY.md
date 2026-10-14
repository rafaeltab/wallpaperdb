# Gateway Catalogue

The Gateway Catalogue lets visitors discover wallpapers and their public contributors. It interprets published wallpaper, Media delivery, color, and Profile facts.

The Wallpaper Asset and discovery terms below follow the [accepted Source rendition model](https://github.com/rafaeltab/wallpaperdb/issues/269#issuecomment-6152919559). [Architecture reconciliation](https://github.com/rafaeltab/wallpaperdb/issues/391) tracks its replacement of the earlier single-source model.

## Language

**Catalogue**:
The browsable collection of published wallpapers and public contributor Profiles.
_Avoid_: Write model, source of truth

**Wallpaper**:
A published image available for discovery, associated with its contributor's Profile ID.
_Avoid_: Upload command, asset file

**Wallpaper Asset**:
The stable Media Asset associated with a Wallpaper, containing its Source renditions and Media-established delivery capabilities and Source facts.
_Avoid_: Variant, stored rendition inventory

**Source facts**:
Media-established characteristics of individual Source renditions used for discovery. Unknown characteristics remain unknown; conversion capabilities are not Source facts.

**Discovery eligibility**:
The catalogue's knowledge that a Wallpaper has been published and its Asset has a non-empty announced set of faithful Delivery capabilities, including unchanged-source delivery. Deliberate withdrawal of the last source removes eligibility; temporary delivery outages do not.

**Contributor Profile**:
The catalogue's public view of the Profile that contributed a wallpaper. The User context owns its identity and presentation.
_Avoid_: Authenticated User, account

**Color query**:
A request to rank wallpapers by color targets, a vibe or requested-proportion mode, and a quality preference.
_Avoid_: Color histogram query, color preference vector

**Color target**:
A concrete color or named visual quality that contributes independently to a color query's relevance score.
_Avoid_: Extracted color, dominant color, exclusive palette bucket

**Color vibe**:
The degree to which a wallpaper conveys a target color or visual quality, based on its matching area and match quality.
_Avoid_: Exact palette, minimum coverage

**Requested proportion**:
A desired whole-image amount for one color target. Other targets remain independent, and the unspecified remainder stays unconstrained.
_Avoid_: Relative amount, blend weight

**Quality preference**:
The relaxed, favorite, or strict balance between matching area and color quality used by a color query.
_Avoid_: Independent quality controls, coverage threshold

**Color utility**:
The complete relevance score for one target, request mode, proportion, and quality preference.
_Avoid_: Coverage percentage, extracted color measurement

**Utility bank**:
The complete set of color utilities supported by Catalogue discovery for a wallpaper.
_Avoid_: Color histogram, disjoint palette

**Projection**:
The catalogue's interpretation of a published fact from an owning context.
_Avoid_: Authoritative record
