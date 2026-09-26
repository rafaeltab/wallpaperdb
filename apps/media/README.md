# Media service

Media delivers original wallpapers, resized renditions, and current Profile pictures from private object storage. It maintains its own PostgreSQL delivery catalog from Ingestor, Variant Generator, and User events.

`GET /wallpapers/:id` accepts optional `w`, `h`, and `fit=contain|cover|fill`. Contain preserves aspect ratio within the requested box; cover crops; fill stretches. Contain and cover do not enlarge. Media chooses the smallest suitable variant, then falls back to the original if that variant object is absent. Technical storage failures return uncached 503; missing originals return 404. Successful delivery has immutable one-year caching.

`GET /profile-pictures/:pictureId` and HEAD check User's availability endpoint for every origin request. Set `USER_SERVICE_URL` and the shared `USER_MEDIA_SERVICE_TOKEN`. Missing configuration or failed authority checks fail closed. Successful picture bodies are fully read before caching. User owns retirement and storage retention; immutable cached copies cannot be recalled.

The `delivery`, `catalog`, and `availability` modules expose application-owned Effect ports. Adapters own PostgreSQL, S3, native Sharp workers, and NATS. The HTTP boundary runs effects and translates outcomes into RFC 9457 Problem Details. The process owns telemetry and scoped startup/shutdown. See [the context decision](docs/adr/0001-replay-safe-delivery-catalog.md).

## Development and verification

Use `make infra-start`, `make migrate PACKAGE=media`, then `make dev PACKAGE=media`. Worktree ingress and infrastructure ports come from the generated environment; `make help` prints the ingress address.

Run `make check PACKAGE=media` and `make test-focused PACKAGE=media`. `make check-crap PACKAGE=media CRAP_THRESHOLD=30` includes all production source. Tests cover capability policy, real adapter guarantees, transport translation, and production composition. Deploy the complete `dist` directory so deferred imports and `resize-worker.mjs` remain available.

## Deployment and retained work

Apply generated database migrations before starting the new service. Do not reset the catalog. The new occurrence, target, and outbox records protect subsequent replay; the first encounter with a legacy asset can issue one new availability announcement using its preserved stored metadata.

Three durable names remain unchanged:

- `media-wallpaper-uploaded-consumer` on the configured wallpaper stream.
- `media-wallpaper-variant-uploaded-consumer` on that same stream.
- `media-profile-picture-snapshots` on `PROFILE`.

Startup rejects a legacy finite-MaxDeliver consumer with recorded redeliveries. Updating its retry limit cannot revive already exhausted messages. Recover it with all Media replicas stopped:

1. Save `manager.consumers.info(stream, durable)` to an operator-owned file and inspect retained source history. Do not purge the source stream.
2. Verify that the source still retains the required messages. Record `saved.ack_floor.stream_seq + 1` as the restart sequence. Previously acknowledged legacy omissions require a separately chosen earlier replay point.
3. Delete only that durable consumer, then recreate it using the same filter and the recorded starting sequence. This NATS SDK configuration is exercised by the migration tests:

```ts
await manager.consumers.delete(stream, durable);
await manager.consumers.add(stream, {
  durable_name: durable,
  ack_policy: AckPolicy.Explicit,
  max_deliver: -1,
  filter_subject: saved.config.filter_subject,
  deliver_policy: DeliverPolicy.StartSequence,
  opt_start_seq: saved.ack_floor.stream_seq + 1,
});
```

4. Restart Media and monitor `/health`, quarantine, and pending outbox records. New consumers get finite application processing attempts and unlimited broker redelivery while durable quarantine is unavailable.

`MEDIA_QUARANTINE` retains failed inputs for thirty days with a one-GiB capacity and DiscardNew overflow. Startup rejects incompatible existing policies. Repair or export failures before expiry. Failed quarantine writes leave inputs pending; free capacity or restore NATS and they retry. Restrict quarantine access because it contains original events. Chunked records require reconstruction and SHA-256 verification from the manifest before replay. Restore `original-ce-*` headers to `ce-*`, retaining source and ID. Do not replay quarantine envelope identities as new domain occurrences.

Outbox publication is at least once with a stable occurrence identity. Outbox health becomes degraded on dispatch failures and recovers after a successful poll. Persistent delivery catalog and ledger records survive broker deduplication windows. Monitor dependency/consumer health and quarantine capacity; a working wallpaper request does not prove that background ingestion is healthy.
