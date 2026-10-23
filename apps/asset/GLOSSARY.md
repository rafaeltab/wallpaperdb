# Asset service

The Asset service's accepted target model owns the lifecycle of Assets and delivers requested Renditions. The [Source rendition resolution](https://github.com/rafaeltab/wallpaperdb/issues/269#issuecomment-6152919559) records the product policy; [architecture reconciliation](https://github.com/rafaeltab/wallpaperdb/issues/391) tracks the transition from the existing producer-owned immutable-Asset model.

## Language

**Delivery catalog**:
The Asset service's local record of which Assets, Source renditions, and Materialized renditions can be delivered.

**Asset**:
Stable media identity containing immutable Source renditions whose membership can change while its identity remains the same. An Asset may be empty before its first accepted source; afterward, source management retains at least one source until full Asset deletion.
_Avoid_: File, original when referring to non-Wallpaper assets

**Asset ID**:
The stable identity assigned to an Asset by the Asset service, distinct from Source rendition identities and the consuming application's domain identities.

**Asset deletion**:
The terminal end of an Asset's lifecycle, authorized by its application and executed by the Asset service. A deleted Asset cannot be restored by later source activity; completing physical cleanup is distinct from disabling its delivery.

**Application reference**:
An opaque reference supplied by an application to associate Asset creation and its confirmation with the application's own domain record. It is distinct from Asset ID, Owner reference and command identity; a new creation command can reuse it for a fresh Asset.

**Creating application**:
The trusted application that requested an Asset's creation and may authorize its full deletion. It is distinct from the Asset owner and from the application's opaque Application reference.

**Asset type**:
A classification selecting an Asset's Source acceptance policy, permitted lifecycle transitions and private-evidence retention policy.

**Asset owner**:
The principal whose ownership permits author operations on an Asset's Source renditions. Full Asset deletion requires the Creating application's authority.

**Owner reference**:
The combination of an Owner namespace and an opaque subject identifying an Asset owner. Both parts must match for ownership; the same subject in another namespace identifies a different owner.

**Owner namespace**:
The identity authority within which an Owner reference's subject has meaning. Applications sharing that authority can refer to the same owner without making their own domain identities part of the Asset service's language.

**Rendition**:
A representation of an Asset with specified delivery characteristics such as dimensions, fit, format, motion, color gamut, dynamic range, bit depth, and transparency. A Rendition may be materialized or produced on request.
_Avoid_: Version, variant

**Rendition request**:
The delivery characteristics requested for an Asset. The Asset service either satisfies the complete request or rejects an unsupported combination.
_Avoid_: Transformation options

**Preserve selector**:
A Rendition request value referring to the corresponding characteristic of the Asset's Default Source rendition. Selecting another source does not relax this preservation requirement.

**Inherit selector**:
A Rendition request value referring to a characteristic or sizing reference of the Source rendition selected to fulfill the request. All inherited characteristics refer to that same source, which must satisfy explicit values and preservation requirements.

**Inherited dimensions**:
The selected Source's native displayed size when both axes inherit, or the proportional axis derived from its aspect ratio when the other axis is numeric. Omitted dimensions inherit.

**Faithful rendition**:
A Rendition that satisfies every requested characteristic through exact source-byte delivery or a source/request combination qualified under the [accepted delivery policy](https://github.com/rafaeltab/wallpaperdb/issues/250) and applicable [HDR qualification policy](https://github.com/rafaeltab/wallpaperdb/issues/263#issuecomment-5874883153). Explicitly requested fitting, SDR conversion, and re-encoding can be faithful when their processing path qualifies; preservation requests retain the characteristics they promise.

**Source rendition**:
A creator-supplied immutable representation of an Asset, including a processed crop accepted through source intake. Different Source renditions can carry separately authored SDR/HDR appearances or encode the Asset at different resolutions or in different formats.

**Source rendition ID**:
The stable identity of one immutable Source rendition. Changed source bytes receive a different identity.

**Default Source rendition**:
The accepted Source rendition designated as an Asset's reference for preservation requests, distinct from whichever source fulfills a particular request. The first accepted source becomes the default; an accepted replacement inherits that designation, and withdrawal requires choosing another default first.

**Source withdrawal**:
Removal of a non-default Source rendition from an Asset's active membership while retaining at least one source. It is distinct from deleting the entire Asset.

**Private evidence retention**:
The Asset service's retention of retired Source bytes under the policy selected by Asset type, separately from public delivery and active source membership. Retained evidence does not restore a deleted Asset, and its recorded expiry survives later configuration changes.

**Source candidate**:
An Owner's private proposal to add or replace a Source rendition, bound to one Asset and one intended operation. Receiving its bytes or verifying its mandatory facts does not make it an accepted member of the Asset. Cancelling a candidate cannot withdraw an accepted Source rendition.

**Source acceptance policy**:
The rules selected by Asset type governing whether the Asset service accepts a proposed Source rendition. Changes apply to later additions and replacements without automatically withdrawing already accepted sources.

**Source acceptance**:
The Asset service's admission of a Source rendition into an Asset's active membership after verifying every mandatory Source acceptance policy rule. Supplementary Inspection can remain pending without preventing unchanged delivery.

**Source intake**:
The preparation and validation of creator-supplied material before accepting it as a Source rendition, including Profile picture crop processing. Its authoring policy may allow enlargement before acceptance; rendition delivery cannot enlarge the resulting accepted Source.

**Similar aspect ratio policy**:
A Source acceptance policy limiting the relative difference between the two most different displayed aspect ratios among a candidate and the active Source renditions, including the source being replaced. Withdrawn sources do not constrain later uploads.
_Avoid_: Shape compatibility rule

**Visual continuity rule**:
A deferred Source acceptance rule requiring additions or replacements to preserve the Asset's visual composition and content, while permitting changes in representation or quality.

**Generated rendition**:
A representation the Asset service produces by processing source media. A Generated rendition may be produced on request or stored as a Materialized rendition.

**Materialized rendition**:
A stored Generated rendition with an immutable identity and Source provenance that the Asset service can reuse to satisfy Rendition requests. It is distinct from a creator-supplied Source rendition.
_Avoid_: Cached file, pre-generated version

**Source facts**:
The characteristics the Asset service has established about a Source rendition, including its displayed dimensions, orientation, format, motion, color, precision, and transparency. An unknown characteristic remains unknown rather than taking an assumed value.

**Inspection**:
The Asset service's examination of a Source rendition to establish its Source facts. Inspection readiness is separate from its availability for unchanged delivery.

**Original-delivery availability**:
The Asset service's confirmation that a Source rendition has entered its delivery catalog for unchanged delivery, subject to the Asset's lifecycle rules. This is independent of Inspection readiness and is not a continuous service-health guarantee.

**Delivery capabilities**:
The combinations of Faithful renditions the Asset service can deliver for an Asset from eligible sources under current processing support and limits, without enlarging an accepted Source. They do not describe the inventory of Materialized renditions.

**Available renditions announcement**:
The Asset service's published snapshot of an Asset's faithful Delivery capabilities, including qualified conversions and unchanged delivery. It describes jointly supported output characteristics and sizing constraints without enumerating Source membership, stored inventory or every output resolution.

**Original-only**:
A Source rendition readiness state in which the Asset service offers unchanged bytes but no transformations. Unknown required Source facts prevent transformation capabilities for that source.

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

**Availability announcement (legacy)**:
The earlier complete snapshot of a producer-owned Source Asset's availability, Inspection readiness and public Source facts. The target discovery contract uses the Available renditions announcement instead.
