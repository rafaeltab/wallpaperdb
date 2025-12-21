# Security Headers Implementation

> **Status:** Planned  
> **Priority:** Medium  
> **Estimated Effort:** 2-3 days  
> **Dependencies:** All services (Ingestor, Media, Gateway)  

## Overview

Add security HTTP headers to all Fastify services using `@fastify/helmet`.

## Current Missing Headers

- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Content-Security-Policy`
- `Strict-Transport-Security` (HSTS)
- `Referrer-Policy`

## Implementation

### 1. Install Dependency

```bash
pnpm add @fastify/helmet
```

### 2. Register in Each Service

```typescript
// apps/{service}/src/app.ts
import helmet from '@fastify/helmet';

await fastify.register(helmet, {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'https:'],
    },
  },
  hsts: config.nodeEnv === 'production' ? {
    maxAge: 31536000,
    includeSubDomains: true,
  } : false,
});
```

## Acceptance Criteria

- [ ] All services use `@fastify/helmet`
- [ ] CSP configured per service
- [ ] HSTS enabled in production only
- [ ] Tests verify headers present
