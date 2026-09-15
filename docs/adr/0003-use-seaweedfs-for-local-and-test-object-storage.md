# Use SeaweedFS for local and test object storage

Replace MinIO with SeaweedFS in Docker Compose and Testcontainers. The September 15, 2026 [CI run](https://github.com/rafaeltab/wallpaperdb/actions/runs/34914707486) and [E2E run](https://github.com/rafaeltab/wallpaperdb/actions/runs/34914707477) failed while pulling MinIO images. MinIO's [official repository](https://github.com/minio/minio#source-only-distribution) now distributes its community edition as source only, states that it is no longer maintained, and was archived on April 25, 2026.

SeaweedFS provides an [Apache-2.0 licensed](https://github.com/seaweedfs/seaweedfs/blob/4.47/LICENSE), maintained S3-compatible server with an upstream Docker image and a [single-process `mini` mode](https://github.com/seaweedfs/seaweedfs/wiki/Quick-Start-with-weed-mini) suited to local infrastructure and disposable test containers. Pin `chrislusf/seaweedfs:4.47`, [released September 14, 2026](https://github.com/seaweedfs/seaweedfs/releases/tag/4.47), rather than following `latest`. The [published image](https://hub.docker.com/r/chrislusf/seaweedfs/tags?name=4.47) supports both AMD64 and ARM64; upgrades should run the storage integration and application tests before changing the pin.

## Considered options

| Option | Assessment |
| --- | --- |
| SeaweedFS | Selected for its maintained release, upstream images, single-container startup, S3 API, and bucket-scoped anonymous reads. |
| Garage | A reasonable lightweight alternative. Its [v2.3.0 quick start](https://garagehq.deuxfleurs.fr/documentation/quick-start/) now supports single-node bootstrap, but it requires a separate configuration file and uses its own permission model; [S3 bucket policies and ACLs are unsupported](https://garagehq.deuxfleurs.fr/documentation/reference-manual/s3-compatibility/). |
| RustFS | Offers an S3-compatible replacement, but the [current release](https://github.com/rustfs/rustfs/releases/tag/1.0.0-rc.6) is still a prerelease. Prefer an established stable release for this migration. |
| Build MinIO ourselves | Retains compatibility but makes us responsible for distributing images of an unmaintained upstream project. |

## Consequences

- Applications continue using AWS SDK S3 clients, path-style addressing, `us-east-1`, and the existing endpoint and credential configuration. Existing `MinioConnection` and test-builder names remain compatibility interfaces; they do not select a MinIO server.
- SeaweedFS listens on port 9000. Its built-in bucket bootstrap replaces the separate MinIO Client image. Local `wallpapers` and `example-bucket` retain anonymous object reads while writes require configured credentials. In [4.47's implementation](https://github.com/seaweedfs/seaweedfs/blob/4.47/weed/s3api/auth_credentials.go), environment credentials are merged with static identities, allowing the anonymous policy to live in a file without embedding administrator credentials.
- Disable `mini`'s automatic bucket creation on upload and recursive deletion of nonempty buckets to preserve ordinary S3 behavior. Container readiness must include dependency/bucket readiness: [the S3 status handler](https://github.com/seaweedfs/seaweedfs/blob/4.47/weed/s3api/s3api_status_handlers.go) alone reports only that the HTTP listener is serving.
- Use a new SeaweedFS data volume. MinIO's on-disk format cannot be reused as SeaweedFS data. Existing objects require an explicit copy between running S3 endpoints, preserving bucket names, keys, metadata, and content, followed by verification before switching application endpoints. Keep the old volume intact until that copy is verified; this code migration does not perform or delete a user's stored-data migration.
