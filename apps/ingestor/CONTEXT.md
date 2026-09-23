# Wallpaper Ingestion

Ingestion accepts an authenticated Profile's wallpaper bytes and owns the durable progress from acceptance to an acknowledged upload announcement. A wallpaper's owner is the authenticated Profile ID; multipart fields cannot assign ownership.

## Language

- **Upload**: one Profile's attempt to introduce wallpaper content. Identical content for the same Profile resolves to the existing active upload; another Profile may upload the same bytes.
- **Inspected content**: bytes whose detected format, size, and dimensions satisfy the ingestion policy. Currently JPEG, PNG, and WebP images are supported.
- **Upload reservation**: persisted identity, owner, complete inspected metadata, logical asset reference, and announcement occurrence before object storage begins.
- **Stored upload**: an upload whose immutable original asset exists and whose announcement is durably recorded in the outbox.
- **Upload announcement**: the committed fact that a wallpaper original is available for downstream processing. Repeated delivery preserves the occurrence's source and ID.
- **Processing upload**: the broker has durably acknowledged its upload announcement. Ingestion does not claim that downstream enrichment has finished.
- **Recovery lease**: expiring ownership of one incomplete upload's recovery work. It prevents ordinary concurrent recovery while allowing another replica to resume after a crash.
- **Quarantined announcement**: a stored upload whose finite publication attempts are exhausted. Its outbox occurrence remains available for operational investigation and deliberate replay.

## Relationships

Ingestion publishes wallpaper upload announcements for independent enrichment and catalogue consumers. It uses the Profile ID as an ownership fact without synchronously hydrating another context. Immutable original assets use a logical wallpaper ID and extension inside the capability; storage adapters own bucket and object-key translation.

## Policy

Inspection permits images up to 50 MiB, with dimensions from 1280×720 through 7680×4320. Content determines format; the supplied MIME type is diagnostic input. Anonymous ingestion is rejected. Recovery checks the exact persisted asset reference, retries missing originals finitely, and publishes only after stored state and an outbox entry commit together.
