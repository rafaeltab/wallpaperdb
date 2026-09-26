# IPv4 URL resolver

Resolves hostnames to IPv4 addresses for connection URLs. Use it when a connection explicitly needs IPv4.

This helper does not reject private addresses or prevent DNS rebinding. Callers needing SSRF protection must enforce that policy separately.
