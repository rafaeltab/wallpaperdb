# Use SeaweedFS for local and test object storage

Replace MinIO with SeaweedFS in Docker Compose and Testcontainers. The September 15, 2026 [CI run](https://github.com/rafaeltab/wallpaperdb/actions/runs/34914707486) and [E2E run](https://github.com/rafaeltab/wallpaperdb/actions/runs/34914707477) failed while pulling MinIO images. MinIO's [official repository](https://github.com/minio/minio#source-only-distribution) now distributes its community edition as source only, states that it is no longer maintained, and was archived on April 25, 2026.

SeaweedFS provides an [Apache-2.0 licensed](https://github.com/seaweedfs/seaweedfs/blob/4.47/LICENSE), maintained S3-compatible server with an upstream Docker image and a [single-process `mini` mode](https://github.com/seaweedfs/seaweedfs/wiki/Quick-Start-with-weed-mini) suited to local infrastructure and disposable test containers. Pin `chrislusf/seaweedfs:4.47`, [released September 14, 2026](https://github.com/seaweedfs/seaweedfs/releases/tag/4.47), rather than following `latest`. The [published image](https://hub.docker.com/r/chrislusf/seaweedfs/tags?name=4.47) supports both AMD64 and ARM64; upgrades should run the storage integration and application tests before changing the pin.

## Considered options

| Option | Assessment |
| --- | --- |
| SeaweedFS | Selected for its maintained release, upstream images, single-container startup, S3 API, and bucket-scoped anonymous reads. |
| Garage | [v2.3.0 quick start](https://garagehq.deuxfleurs.fr/documentation/quick-start/) supports single-node bootstrap, but it requires a separate configuration file and uses its own permission model; [S3 bucket policies and ACLs are unsupported](https://garagehq.deuxfleurs.fr/documentation/reference-manual/s3-compatibility/). |
| RustFS | Offers an S3-compatible replacement, but the [current release](https://github.com/rustfs/rustfs/releases/tag/1.0.0-rc.6) is still a prerelease. Prefer an established stable release for this migration. |
| Chainguard MinIO | Provides publicly pullable server and client images and a [security-maintained fork](https://github.com/chainguard-forks/minio). It would restore CI with fewer changes, but [EmeritOSS](https://github.com/chainguard-forks) does not commit to new features or general bug fixes. We prefer an actively developed storage engine for the long term. |
| Build MinIO ourselves | Retains compatibility but makes us responsible for distributing images of an unmaintained upstream project. |

## Consequences

- Keep AWS SDK S3 clients, path-style addressing and `us-east-1`. Shared interfaces and service settings use S3 terminology, decoupled from the storage engine.
- Use canonical `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` and `S3_API_HOST_PORT` settings, without legacy fallbacks or aliases. Local credentials default to `storageadmin`. Existing installations must map custom values and regenerate environments before restarting; see the [migration guide](../../apps/docs/content/docs/infrastructure/seaweedfs.mdx#existing-minio-data).
- SeaweedFS serves port 9000 and bootstraps buckets without a separate client image. Local `wallpapers` and `example-bucket` allow anonymous reads but require credentials for writes. [Version 4.47 merges environment credentials with static identities](https://github.com/seaweedfs/seaweedfs/blob/4.47/weed/s3api/auth_credentials.go), so the anonymous policy need not contain administrator credentials.
- Disable automatic bucket creation on upload and recursive deletion of nonempty buckets to preserve ordinary S3 behavior. Readiness must check dependencies and buckets; [S3 status alone](https://github.com/seaweedfs/seaweedfs/blob/4.47/weed/s3api/s3api_status_handlers.go) proves only that the listener serves HTTP.
- Start with a new volume. MinIO's on-disk data cannot be reused. Copy existing objects between running S3 endpoints, preserving buckets, keys, metadata and content. Verify the copy before switching endpoints and retain the old volume until then; the code migration does not migrate or delete stored data.
