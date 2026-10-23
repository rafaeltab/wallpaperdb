# IPv4 URL resolver

Resolves hostnames to IPv4 addresses for connection URLs. Use it when a connection explicitly needs IPv4.

## Core capabilities

- Resolves bare hostnames, including local names, or the hostname in a URL or connection string.
- Retains the scheme, credentials, port, path, and query when replacing a URL's hostname.
- Returns bare IPv4 addresses unchanged without a DNS lookup.

This helper does not reject private addresses or prevent DNS rebinding. Callers needing SSRF protection must enforce that policy separately.

See the [resolver](src/index.ts) and [tests](test/resolver.test.ts) for supported inputs.

The behavioral suite controls Node's DNS lookup at its import boundary, so tests do not depend on live DNS. It checks the returned address and preserved URL components through `resolveUrlIpv4`; the runtime API still uses Node's resolver.

The [mutation configuration](mutation.config.json) uses this same suite for the native Vitest unit stage. See the [mutation pilot guidance](../../CONTRIBUTING.md#incremental-mutation-testing-pilot) for budgets and execution policy.
