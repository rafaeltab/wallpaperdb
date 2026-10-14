# Media

Media's accepted target model owns the lifecycle of Assets and delivers requested Renditions. The [Source rendition resolution](https://github.com/rafaeltab/wallpaperdb/issues/269#issuecomment-6152919559) records the product policy; [architecture reconciliation](https://github.com/rafaeltab/wallpaperdb/issues/391) tracks the transition from the existing producer-owned immutable-Asset model.

## Language

**Delivery catalog**:
Media's local record of which Assets, Source renditions, and Materialized renditions can be delivered.

**Asset**:
Stable media identity containing zero or more immutable Source renditions. Its accepted sources can change while its identity remains the same.
_Avoid_: File, original when referring to non-Wallpaper assets

**Asset ID**:
The stable identity of an Asset, distinct from the identities of its Source renditions.

**Asset type**:
A classification selecting an Asset's Source acceptance policy and permitted lifecycle transitions.

**Asset owner**:
The principal whose ownership permits management of an Asset and its Source renditions.

**Owner reference**:
An opaque, project-agnostic reference to an Asset owner. Its meaning is independent of WallpaperDB-specific identities.

**Rendition**:
A representation of an Asset with specified delivery characteristics such as dimensions, fit, format, motion, color gamut, dynamic range, bit depth, and transparency. A Rendition may be materialized or produced on request.
_Avoid_: Version, variant

**Rendition request**:
The delivery characteristics requested for an Asset. Media either satisfies the complete request or rejects an unsupported combination.
_Avoid_: Transformation options

**Faithful rendition**:
A Rendition that satisfies every requested characteristic through exact source-byte delivery or a source/request combination qualified under the [accepted delivery policy](https://github.com/rafaeltab/wallpaperdb/issues/250) and applicable [HDR qualification policy](https://github.com/rafaeltab/wallpaperdb/issues/263#issuecomment-5874883153). Requested crops, explicit SDR conversion, and re-encoding can be faithful when their processing path qualifies; preservation requests retain the characteristics they promise.

**Source rendition**:
A creator-supplied immutable representation of an Asset. Different Source renditions can carry separately authored SDR/HDR appearances or encode the Asset at different resolutions or in different formats.

**Source rendition ID**:
The stable identity of one immutable Source rendition. Changed source bytes receive a different identity.

**Source acceptance policy**:
The rules governing whether Media accepts a proposed Source rendition for an Asset. The Asset type selects the applicable rules.

**Similar aspect ratio policy**:
A Source acceptance policy limiting relative differences in displayed aspect ratio between Source renditions, after interpreting their orientation.
_Avoid_: Shape compatibility rule

**Visual continuity rule**:
A Source acceptance rule requiring additions or replacements to preserve the Asset's visual composition and content, while permitting changes in representation or quality.

**Generated rendition**:
A representation Media produces by processing source media. A Generated rendition may be produced on request or stored as a Materialized rendition.

**Materialized rendition**:
A stored Generated rendition that Media can reuse to satisfy Rendition requests.
_Avoid_: Cached file, pre-generated version

**Source facts**:
The characteristics Media has established about a Source rendition, including its displayed dimensions, orientation, format, motion, color, precision, and transparency. An unknown characteristic remains unknown rather than taking an assumed value.

**Inspection**:
Media's examination of a Source rendition to establish its Source facts. Inspection readiness is separate from its availability for unchanged delivery.

**Original-delivery availability**:
Media's confirmation that a Source rendition has entered its delivery catalog for unchanged delivery, subject to the Asset's lifecycle rules. This is independent of Inspection readiness and is not a continuous service-health guarantee.

**Delivery capabilities**:
The combinations of Faithful renditions Media can deliver for an Asset from its eligible sources under its current processing support and limits. They do not describe the inventory of Materialized renditions.

**Available renditions announcement**:
Media's published snapshot of an Asset's faithful Delivery capabilities. It describes supported combinations without enumerating every possible output resolution.

**Original-only**:
A Source rendition readiness state in which Media offers unchanged bytes but no transformations. Unknown required Source facts prevent transformation capabilities for that source.

**Original**:
The exact immutable bytes of a selected Source rendition.

**Gain-map image**:
An image with an authored SDR base and separate gain-map data used to reconstruct an HDR appearance. The base and map have their own coded depths; the reconstructed HDR appearance does not have one coded sample depth.

**Authored SDR base**:
The SDR image embedded in a gain-map image, distinct from an SDR rendition made by tone mapping an HDR image.

**HDR-only image**:
An HDR-encoded image without an embedded authored SDR base. A separately authored SDR Source rendition is a different source, not part of this image.

**Variant (legacy)**:
The existing name for a wallpaper-specific Materialized rendition. Use Rendition or Materialized rendition in the replacement domain model.

**Current picture**:
The image currently accepted for display as a Profile's picture.

**Availability announcement**:
Media's published snapshot of an Asset's Source renditions, their Original-delivery availability, Inspection readiness, and public Source facts. It does not expose Materialized rendition inventory.
