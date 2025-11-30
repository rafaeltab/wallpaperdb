# @wallpaperdb/url-ipv4-resolver

URL validation and DNS resolution to IPv4 for SSRF prevention.

## Documentation

**Complete documentation:** [apps/docs/content/docs/packages/url-ipv4-resolver.mdx](../../apps/docs/content/docs/packages/url-ipv4-resolver.mdx)

Run `make docs-dev` from the repository root to view the rendered documentation site.

## Quick Example

```typescript
import { resolveUrlToIPv4, isIPv4Literal } from '@wallpaperdb/url-ipv4-resolver';

// Validate and resolve URL to IPv4
const result = await resolveUrlToIPv4('https://example.com');
console.log(result.ipv4); // '93.184.216.34'

// Check if URL is already an IPv4 literal
const isLiteral = isIPv4Literal('http://192.168.1.1');
console.log(isLiteral); // true
```

## Features

- URL validation and parsing
- DNS resolution to IPv4
- IPv4 literal detection
- SSRF attack prevention

**See the [complete documentation](../../apps/docs/content/docs/packages/url-ipv4-resolver.mdx) for detailed API reference.**
