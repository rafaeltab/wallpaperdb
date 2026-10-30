# Retain Fastify instead of migrating to NestJS

Historical decision, accepted 2025-01-20. The original choice retained Fastify with TSyringe rather than migrating the services to NestJS.

The existing Ingestor already had reusable connection management, error handling, telemetry, and test builders. A NestJS migration would replace framework integration and dependency injection before delivering another service. Its conventions and reduced boilerplate did not justify that migration cost at the project's scale. tRPC targeted a different application shape, and Hono offered no sufficient advantage over the existing minimal framework.

Retaining Fastify preserved that investment and framework flexibility, while leaving the repository responsible for consistent service composition and repeated integration code. Reconsider the framework if service or team growth makes those costs outweigh migration.

This records the framework choice, not a current requirement to use TSyringe. Later context decisions, including [Gateway's Effect services and owned lifetimes](../../apps/gateway/docs/adr/0002-effect-services-and-owned-lifetimes.md), replace its dependency injection conventions.
