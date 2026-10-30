# Retain per-execution GraphQL security checks

Historical decision, accepted 2024-12-21. The original hardening combined transport batch limits, Mercurius depth limits, production introspection restrictions, custom complexity and breadth checks, and signed expiring cursors.

Mercurius caches validation and compiles queries. Validation-only complexity rules therefore did not enforce a work limit on every execution. The selected custom checks ran in `preExecution`, preserving per-request inspection without disabling JIT compilation or replacing Mercurius with Apollo. The attempted external complexity integration also encountered duplicate GraphQL module identities. Keeping schema-specific cost calculation in the gateway avoided that integration and left the repository responsible for maintaining costs as the schema changes.

Signed cursors detect altered offsets and bound cursor lifetime. Encoding offsets as base64 alone provided neither property. Environment-specific errors kept detailed diagnostics out of production responses.

The original IP plus User-Agent request quota is superseded by [weighted IP admission with bounded fallback](0003-weighted-ip-admission-with-bounded-fallback.md). Its historical performance estimates, IP metric labels, and broad denial-of-service claims are not deployment guarantees. The replacement ADR defines the current threat model and admission tradeoffs.

The later module-identity incident on 2026-03-30 affected cold Gateway test runs. Vitest loaded GraphQL's ESM entry while Mercurius used CommonJS, producing different constructor identities. [Gateway's Vitest configuration](../../vitest.config.ts) aliases GraphQL to one CommonJS entry. Dependency-resolution changes need cold-run verification because a warm transform cache concealed the failure. Removing Mercurius's `ssr.noExternal` setting alone did not fix it.
