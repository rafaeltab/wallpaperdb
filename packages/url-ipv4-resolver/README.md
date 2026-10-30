# IPv4 URL resolver

[Resolves](src/index.ts) bare hostnames, local names, and hostnames in URLs or connection strings to IPv4 addresses. Preserves the scheme, credentials, port, path, and query. Bare IPv4 addresses bypass DNS.

Callers must enforce any SSRF protection separately; this helper neither rejects private addresses nor prevents DNS rebinding. See the [tests](test/resolver.test.ts) for supported inputs.
