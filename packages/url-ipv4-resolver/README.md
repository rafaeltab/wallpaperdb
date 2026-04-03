# @wallpaperdb/url-ipv4-resolver

Resolves hostnames in URLs, connection strings, and bare domain names to their IPv4 addresses, enabling SSRF prevention by making the resolved IP available for block-list checks before any outbound request is made.

## Key Capabilities

- Accepts full URLs, connection strings, or bare domain names and returns the input with every hostname replaced by its resolved IPv4 address
- Passes IPv4 literals through unchanged without performing a DNS lookup
- Handles single-label names such as `localhost` as well as multi-label domains
- Preserves the rest of the URL structure (scheme, port, path, query string) when resolving full URLs

## Technology

Uses Node.js's built-in `dns/promises` module with explicit IPv4-family resolution to guarantee a routable address is returned rather than an IPv6 address or a CNAME chain.
