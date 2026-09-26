# IPv4 URL resolver

Resolves hostnames to IPv4 addresses for connection URLs. Use it when a connection explicitly needs IPv4.

## Core capabilities

- Resolves bare hostnames, including local names, or the hostname in a URL or connection string.
- Retains the scheme, credentials, port, path, and query when replacing a URL's hostname.
- Returns bare IPv4 addresses unchanged without a DNS lookup.

This helper does not reject private addresses or prevent DNS rebinding. Callers needing SSRF protection must enforce that policy separately.

See the [resolver](src/index.ts) and [tests](test/resolver.test.ts) for supported inputs.
