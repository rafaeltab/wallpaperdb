# Media

Media delivers authorized renditions of committed Assets and owns on-request rendition processing. Its delivery catalog identifies Assets and Materialized renditions available for delivery.

## Language

**Delivery catalog**:
Media's local record of which assets and materialized renditions can be delivered.

**Asset**:
Immutable source media identified by a stable Asset ID.
_Avoid_: File, original when referring to non-Wallpaper assets

**Asset ID**:
The stable identity assigned by the source producer: the Wallpaper ID for a wallpaper Asset or the picture ID for a Profile picture Asset. Media uses that same identity without an owner qualifier or a separate Media identity.

**Rendition**:
A representation of an Asset with specified delivery characteristics such as dimensions, fit, format, motion, color gamut, dynamic range, bit depth, and transparency. A Rendition may be materialized or produced on request.
_Avoid_: Version, variant

**Rendition request**:
The delivery characteristics requested for an Asset. Media either satisfies the complete request or rejects an unsupported combination.
_Avoid_: Transformation options

**Materialized rendition**:
A stored Rendition that Media can reuse to satisfy Rendition requests.
_Avoid_: Cached file, pre-generated version

**Source facts**:
The characteristics Media has established about an Asset, including its displayed dimensions, orientation, format, motion, color, precision, and transparency. An unknown characteristic remains unknown rather than taking an assumed value.

**Inspection**:
Media's examination of an Asset to establish its Source facts. Inspection readiness is separate from the Asset's availability for unchanged delivery.

**Delivery capabilities**:
The Rendition combinations Media can produce for an Asset under its current processing support and limits. They do not describe the inventory of Materialized renditions.

**Original-only**:
An Asset readiness state in which Media offers unchanged source bytes but no transformations. Unknown required Source facts prevent transformation capabilities.

**Original**:
The immutable wallpaper asset accepted by Wallpaper Ingestion.

**Gain-map image**:
An image with an authored SDR base and separate gain-map data used to reconstruct an HDR appearance. The base and map have their own coded depths; the reconstructed HDR appearance does not have one coded sample depth.

**Authored SDR base**:
The SDR image embedded in a gain-map image, distinct from an SDR rendition made by tone mapping an HDR image.

**HDR-only image**:
An HDR-encoded image without an embedded authored SDR base. A separately authored SDR companion is a different source, not part of this image.

**Variant (legacy)**:
The existing name for a wallpaper-specific Materialized rendition. Use Rendition or Materialized rendition in the replacement domain model.

**Current picture**:
The Profile picture identified by the latest accepted Profile snapshot and still permitted by User's origin availability decision.

**Availability announcement**:
Media's statement that an image rendition has entered its delivery catalog.
