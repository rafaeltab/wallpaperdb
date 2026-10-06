# Gateway Catalogue

The Gateway Catalogue lets visitors discover wallpapers and their public contributors. It interprets published wallpaper, Media delivery, color, and Profile facts.

## Language

**Catalogue**:
The browsable collection of published wallpapers and public contributor Profiles.
_Avoid_: Write model, source of truth

**Wallpaper**:
A published image available for discovery, associated with its contributor's Profile ID.
_Avoid_: Upload command, asset file

**Wallpaper Asset**:
The immutable source image identified by the Wallpaper ID, with Media's published delivery availability, inspection readiness, and known Source facts.
_Avoid_: Variant, stored rendition inventory

**Source facts**:
Media-established characteristics of a wallpaper's source image used for discovery. Unknown characteristics remain unknown; conversion capabilities are not Source facts.

**Discovery eligibility**:
The catalogue's knowledge that a wallpaper has been published and Media has confirmed unchanged-source delivery. Inspection readiness is separate, and temporary delivery outages do not withdraw that confirmation.

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
