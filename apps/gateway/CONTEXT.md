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
A requested color, its relative amount, and the acceptable spread around it when ranking wallpapers.
_Avoid_: Extracted color, dominant color

**Projection**:
The catalogue's interpretation of a published fact from an owning context.
_Avoid_: Authoritative record
