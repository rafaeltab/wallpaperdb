# Wallpaper

Wallpaper owns contribution identities, contributor facts and progress through creation of an Asset and acceptance of its first immutable Source. Asset owns bytes, Source admission policy and exact original access.

## Capabilities

- Authenticated creators start a durable creation and inspect its saved progress after navigation or restart.
- Protected application commands reserve a distinct Asset. Matching committed confirmations attach that Asset and publish the first Source once.
- First-Source intent fences unrelated Assets, superseded candidates and replayed confirmations.
- Finite delivery failures retain their original work for operator notification and deliberate recovery.
- Health and readiness include required connections and the running workflow. Shutdown bounds active requests and workers.

PostgreSQL transactions preserve creation state with outgoing responsibility. NATS transports commands and publication facts independently. Wallpaper has no storage client or image processor. Legacy Ingestor and public discovery projections remain separate during the clean rebuild.

Use [contributor setup](../../CONTRIBUTING.md) and the [generated development authority setup](../asset/scripts/development-authority.ts). The generated Wallpaper configuration contains only its application credential, selected Creator verification and operator contact. It is private and excluded from image builds. Provision the protected broker before starting the workflow; development Compose orders that startup explicitly.

Exhausted records carry a recovery identity and scope in the operator inbox. The trusted [Wallpaper operator entry](scripts/operator.ts) requeues an outbox occurrence or reapplies a retained valid confirmation with its original identities. It exposes no public recovery route and cannot make an invalid confirmation valid. See its [workspace scripts](package.json) for invocation and the [schema source](src/db/schema.ts) for migrations.

The [owning spec](https://github.com/rafaeltab/wallpaperdb/issues/456) leaves additional Source workflows, public rendition/discovery integration and final legacy retirement to later tickets. No native HDR processing qualification is implied by this workflow.
