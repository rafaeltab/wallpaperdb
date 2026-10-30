# Project Profiles into the GraphQL read model

User owns Profile state and authenticated REST commands. It records accepted transitions in a transactional outbox and publishes versioned events with the change and current public snapshot. Gateway projects them idempotently into OpenSearch for GraphQL, accepting eventual consistency for searchable, independent reads. NATS events are temporarily retained indefinitely for rebuilds pending the privacy and retention review in [#162](https://github.com/rafaeltab/wallpaperdb/issues/162).
