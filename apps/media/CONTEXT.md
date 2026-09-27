# Media delivery

Media delivers authorized renditions of committed assets. Producers own source assets; Media owns rendition selection and its delivery catalog.

## Language

**Delivery catalog**:
Media's local record of which assets and materialized renditions can be delivered.

**Asset**:
Immutable source media identified by a stable Asset ID.
_Avoid_: File, original when referring to non-Wallpaper assets

**Rendition**:
A representation of an Asset with specified delivery characteristics such as dimensions, fit, format, motion, color gamut, dynamic range, bit depth, and transparency. A Rendition may be materialized or produced on request.
_Avoid_: Version, variant

**Rendition request**:
The delivery characteristics requested for an Asset. Media either satisfies the complete request or rejects an unsupported combination.
_Avoid_: Transformation options

**Materialized rendition**:
A stored Rendition that Media can reuse to satisfy Rendition requests.
_Avoid_: Cached file, pre-generated version

**Original**:
The immutable wallpaper asset accepted by Wallpaper Ingestion.

**Variant (legacy)**:
The existing name for a wallpaper-specific Materialized rendition. Use Rendition or Materialized rendition in the replacement domain model.

**Current picture**:
The Profile picture identified by the latest accepted Profile snapshot and still permitted by User's origin availability decision.

**Availability announcement**:
Media's statement that an image rendition has entered its delivery catalog.
