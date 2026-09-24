# Effect ingestion with durable publication

Status: accepted

The former ingestor mixed authentication, HTTP errors, SQL, storage clients, and event publication in TSyringe services. Recovery held database transactions open while calling storage and NATS; retries generated new event identities, and incomplete upload records could not recover non-JPEG assets reliably.

The `Ingestion` driving port owns upload and recovery decisions. Its dependencies are application-owned Effect services for content inspection, immutable assets, occurrence identities, publication, and persistence. Composition builds scoped Layers once per application. Normal rejections are explicit values; technical failures use `IngestionUnavailable` with an opaque diagnostic cause. Infrastructure types and lifecycle management remain in adapters.

Upload reservations persist complete inspected metadata and distinct wallpaper, event, workflow, command, and lease identities before storing bytes. The same Profile/content pair is an idempotent command identity. Stored state and the original announcement are committed atomically in a PostgreSQL outbox. A broker acknowledgement advances the upload to processing; an ambiguous acknowledgement may publish the same occurrence again. Broker deduplication supplements stable consumer identity and is not an exactly-once claim.

Recovery claims at most 100 records per cycle using expiring row leases and runs at most five operations concurrently. Transactions end before network calls begin. Every mutation checks the lease token. Missing original assets receive three recovery attempts. Publication receives ten attempts, after which the durable outbox is quarantined. Quarantine is deliberately retained for investigation and replay; a stored original is never deleted merely because its announcement could not be published. Cleanup processes at most ten storage pages per cycle and resumes the cursor in the same application lifetime.

The event adapter emits CloudEvents 1.0 metadata while retaining the shared legacy wallpaper payload fields used by existing enrichment consumers. The local capability uses logical asset identities; the adapter translates them to the legacy bucket/key contract. Replacing that cross-service payload requires coordinated producer, consumer, and retained-event migration and is outside this service's architectural change.

Capability tests exercise the full decision matrix using controlled adapters and a controlled Effect clock. PostgreSQL contract tests verify reservations, atomic outbox commits, concurrency, leases, and quarantine against one real database per suite. Only a small representative composed path needs the complete infrastructure stack.

## Deployment and existing records

First rebuild and restart every Media, Variant Generator, Color Extractor, and User consumer replica with the updated `@wallpaperdb/events` upload-event schema. It accepts both legacy and CloudEvents envelopes, allowing consumers to upgrade while the old ingestor still runs. Only start the new ingestor after all four services have upgraded: old consumer binaries reject CloudEvents and terminate delivery, so a later consumer upgrade does not cause ordinary redelivery. Retain support for both formats for the lifetime of retained events and replay.

Drain and stop all old ingestor replicas before running `make migrate PACKAGE=ingestor`, then start the new deployment. The migration entry prepares existing data, runs the generated Drizzle schema migrations, and adopts complete legacy records in batches. It preserves committed originals, deterministically resolves duplicate unfinished reservations, and marks metadata-incomplete interrupted uploads failed so clients can retry. Existing stored records gain one deterministic upload occurrence and outbox row atomically. Completed and processing records retain their state. Re-running migration preserves occurrence identity and does not add announcements for already processing uploads.

Before changing any rows or schema, the migration validates stored, processing, and completed records in batches of 100. Incomplete committed metadata stops migration for operator repair; the original state and its protection from cleanup remain unchanged. Repair the metadata and rerun the migration. Only incomplete initiated or uploading records are marked failed automatically.

Use the package migration entry rather than invoking Drizzle Kit directly on a populated database: preparation must precede the broadened uniqueness constraint. Migration operations are serialized with a session advisory lock. Failed preparations or backfills can be rerun after fixing their cause; schema changes remain generated from the Drizzle schema.
