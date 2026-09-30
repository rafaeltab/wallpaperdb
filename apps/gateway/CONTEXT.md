# Gateway Catalogue

The Gateway Catalogue lets visitors discover wallpapers and their public contributors. It interprets published facts from the contexts that own wallpapers, variants, colors, and Profiles.

## Language

**Catalogue**:
The browsable collection of published wallpapers and public contributor Profiles.
_Avoid_: Write model, source of truth

**Wallpaper**:
A published image available for discovery, associated with its contributor's Profile ID.
_Avoid_: Upload command, asset file

**Variant**:
An available rendition of a wallpaper with particular dimensions and format.
_Avoid_: Duplicate wallpaper

**Contributor Profile**:
The catalogue's public view of the Profile that contributed a wallpaper. The User context owns its identity and presentation.
_Avoid_: Authenticated User, account

**Color preference**:
A requested color or named visual property, expressed as an overall impression or a desired whole-image proportion, with a quality preference.
_Avoid_: Extracted color, dominant color

**Color vibe**:
A requested overall color impression without a specified image proportion.

**Target proportion**:
The desired fraction of the whole image matching a color target, or the requested strength of a named distribution property. It is not a relative palette weight; unrequested image area remains unspecified.

**Color utility**:
A single target's relevance score for a request mode, proportion, and quality preference, derived from wallpaper color measurements. It is not a measured image percentage.
_Avoid_: Coverage, histogram, extracted color measurement

**Utility bank**:
The complete set of color utilities supported by Catalogue discovery for a wallpaper.
_Avoid_: Color histogram, disjoint palette

**Projection**:
The catalogue's interpretation of a published fact from an owning context.
_Avoid_: Authoritative record
