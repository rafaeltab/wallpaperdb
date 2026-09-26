# @wallpaperdb/events

Public event schemas for communication between WallpaperDB applications.

The root entry point and `@wallpaperdb/events/schemas` export Zod schemas, inferred payload types, and subject names. Contracts cover wallpaper uploads, generated and available variants, extracted colors, and complete public Profile snapshots.

Applications own their Effect-based broker adapters and translate these contracts into local capability inputs. Their publishers preserve CloudEvents occurrence identity through retries and await JetStream PubAck. Their consumers acknowledge completed or durably accepted work, delay finite retries, and confirm durable quarantine before terminating permanent failures.

The former publisher and consumer base classes have no application consumers and have been removed. They did not provide the required delivery guarantees. See `docs/coding-standards/distributed-interactions.md` and `docs/coding-standards/nats.md` for the authoritative requirements.
