# GraphQL Security Hardening

> **Status:** Planned  
> **Priority:** High  
> **Estimated Effort:** 1-2 weeks  
> **Dependencies:** Gateway service  
> **Triggered By:** Security audit findings  

---

## Overview

The Gateway service's GraphQL API currently lacks critical security protections, making it vulnerable to denial-of-service attacks through deeply nested queries, expensive operations, and unbounded result sets. This plan addresses these vulnerabilities while maintaining API usability.

---

## Current Vulnerabilities

### 1. No Query Depth Limiting

**Issue:** Attackers can create deeply nested queries that exhaust server resources.

**Attack Example:**
```graphql
query {
  searchWallpapers {
    edges {
      node {
        variants {
          url
          # Could nest further if schema allowed
        }
      }
    }
  }
}
```

**Impact:** CPU/memory exhaustion, service degradation

---

### 2. No Query Complexity Analysis

**Issue:** Expensive queries can run without any cost calculation or throttling.

**Attack Example:**
```graphql
query {
  searchWallpapers(first: 1000) {
    edges {
      node {
        wallpaperId
        userId
        variants {
          width
          height
          aspectRatio
          format
          fileSizeBytes
          createdAt
          url
        }
      }
    }
  }
}
```

**Impact:** 
- Database query scans thousands of variant records
- OpenSearch query fetches 1000+ documents
- Network bandwidth abuse
- Slow queries block event loop

---

### 3. No Rate Limiting

**Issue:** GraphQL endpoint has zero rate limiting (unlike Ingestor's upload endpoint).

**Attack Example:**
```bash
# Flood with expensive queries
for i in {1..1000}; do
  curl -X POST http://localhost:4000/graphql \
    -d '{"query": "{ searchWallpapers(first: 100) { edges { node { variants { url } } } } }"}' &
done
```

**Impact:** Service unavailable for legitimate users

---

### 4. Insecure Cursor Pagination

**Issue:** Cursors are base64-encoded integers, making them predictable and manipulable.

**Current Implementation:**
```typescript
// apps/gateway/src/graphql/resolvers.ts:111-114
if (args.after) {
  offset = parseInt(Buffer.from(args.after, 'base64').toString('utf-8'), 10);
}
```

**Attack Example:**
```javascript
// Predict next cursor
const currentCursor = "MTA="; // base64("10")
const decoded = parseInt(Buffer.from(currentCursor, 'base64').toString(), 10); // 10
const nextCursor = Buffer.from(String(decoded + 10)).toString('base64'); // "MjA=" (20)
```

**Impact:**
- Pagination bypass
- Data enumeration
- Not cryptographically secure

---

## Solution Design

### 1. Query Depth Limiting

**Implementation:** Use `graphql-depth-limit` package

**Configuration:**
```typescript
// apps/gateway/src/graphql/config.ts

export const GRAPHQL_CONFIG = {
  maxDepth: 5, // Reasonable for our schema
  // Current max depth in schema:
  // Query → searchWallpapers → edges → node → variants → url (5 levels)
};
```

**Integration:**
```typescript
// apps/gateway/src/app.ts

import depthLimit from 'graphql-depth-limit';

await fastify.register(mercurius, {
  schema,
  resolvers: resolversInstance.getResolvers(),
  validationRules: [depthLimit(GRAPHQL_CONFIG.maxDepth)],
});
```

**Error Response:**
```json
{
  "errors": [
    {
      "message": "Query exceeds maximum depth of 5",
      "extensions": {
        "code": "DEPTH_LIMIT_EXCEEDED"
      }
    }
  ]
}
```

---

### 2. Query Complexity Analysis

**Implementation:** Custom complexity calculator using `graphql-query-complexity`

**Complexity Costs:**
```typescript
// apps/gateway/src/graphql/complexity.ts

export const COMPLEXITY_CONFIG = {
  maxComplexity: 1000, // Max cost per query
  
  // Field costs
  defaultCost: 1,
  listMultiplier: 10, // Cost for each item in list
  
  // Custom field costs
  fieldCosts: {
    'Query.searchWallpapers': 10,
    'Wallpaper.variants': 5, // Each variant adds 5 to cost
    'Variant.url': 1, // Computed field (cheap)
  },
};
```

**Cost Calculation Example:**
```graphql
query {
  searchWallpapers(first: 100) {  # 10 (base) + 100 * 10 (list multiplier) = 1010
    edges {
      node {
        variants {                 # 5 * number of variants per wallpaper
          url                      # 1 per variant
        }
      }
    }
  }
}
# Total: Exceeds 1000 → REJECTED
```

**Integration:**
```typescript
import { createComplexityRule } from 'graphql-query-complexity';

await fastify.register(mercurius, {
  validationRules: [
    depthLimit(GRAPHQL_CONFIG.maxDepth),
    createComplexityRule({
      maximumComplexity: COMPLEXITY_CONFIG.maxComplexity,
      variables: {},
      onComplete: (complexity: number) => {
        recordHistogram('graphql.query.complexity', complexity);
      },
      estimators: [
        // Custom estimators for our schema
        customComplexityEstimator(COMPLEXITY_CONFIG.fieldCosts),
        simpleEstimator({ defaultComplexity: 1 }),
      ],
    }),
  ],
});
```

**Error Response:**
```json
{
  "errors": [
    {
      "message": "Query is too complex: 1523 (max: 1000)",
      "extensions": {
        "code": "COMPLEXITY_LIMIT_EXCEEDED",
        "complexity": 1523,
        "maxComplexity": 1000
      }
    }
  ]
}
```

---

### 3. Rate Limiting

**Implementation:** Per-IP and per-user (future) rate limiting using Redis

**Strategy:**
- **Anonymous users:** IP-based rate limiting (100 requests/min per IP)
- **Authenticated users (future):** User-based rate limiting (500 requests/min per user)

**Configuration:**
```typescript
// apps/gateway/src/config.ts

const ConfigSchema = z.object({
  // ... existing fields
  
  // Rate limiting
  rateLimitEnabled: z.boolean().default(true),
  rateLimitMaxAnonymous: z.number().default(100), // requests per window
  rateLimitMaxAuthenticated: z.number().default(500),
  rateLimitWindowMs: z.number().default(60 * 1000), // 1 minute
});
```

**Implementation:**
```typescript
// apps/gateway/src/services/rate-limit.service.ts

import { RedisConnection } from '@wallpaperdb/core/connections';

@injectable()
export class GraphQLRateLimitService {
  constructor(
    @inject(RedisConnection) private readonly redis: RedisConnection,
    @inject('config') private readonly config: Config
  ) {}
  
  async checkRateLimit(ip: string, userId?: string): Promise<RateLimitResult> {
    const key = userId 
      ? `graphql:ratelimit:user:${userId}`
      : `graphql:ratelimit:ip:${ip}`;
    
    const max = userId 
      ? this.config.rateLimitMaxAuthenticated
      : this.config.rateLimitMaxAnonymous;
    
    // Use same atomic Lua script as Ingestor
    const luaScript = `
      local key = KEYS[1]
      local max = tonumber(ARGV[1])
      local windowMs = tonumber(ARGV[2])
      
      local current = redis.call('GET', key)
      local count = current and tonumber(current) or 0
      
      if count >= max then
        local ttl = redis.call('PTTL', key)
        return {-1, ttl}
      end
      
      count = redis.call('INCR', key)
      if count == 1 then
        redis.call('PEXPIRE', key, windowMs)
      end
      
      local ttl = redis.call('PTTL', key)
      return {count, ttl}
    `;
    
    const result = await this.redis.getClient().eval(
      luaScript,
      1,
      key,
      max,
      this.config.rateLimitWindowMs
    ) as [number, number];
    
    const [count, ttl] = result;
    
    if (count === -1) {
      throw new RateLimitExceededError(max, this.config.rateLimitWindowMs, ttl);
    }
    
    return {
      remaining: max - count,
      reset: Date.now() + ttl,
    };
  }
}
```

**Fastify Hook:**
```typescript
// apps/gateway/src/app.ts

fastify.addHook('preHandler', async (request, reply) => {
  if (request.url === '/graphql' && request.method === 'POST') {
    const ip = request.ip;
    // const userId = extractUserIdFromAuth(request); // Future
    
    try {
      const rateLimitResult = await rateLimitService.checkRateLimit(ip);
      
      // Add headers to all responses
      reply.header('X-RateLimit-Limit', String(config.rateLimitMaxAnonymous));
      reply.header('X-RateLimit-Remaining', String(rateLimitResult.remaining));
      reply.header('X-RateLimit-Reset', String(rateLimitResult.reset));
    } catch (error) {
      if (error instanceof RateLimitExceededError) {
        return reply
          .code(429)
          .header('Retry-After', String(Math.ceil(error.retryAfter / 1000)))
          .send({
            errors: [{
              message: 'Rate limit exceeded',
              extensions: {
                code: 'RATE_LIMIT_EXCEEDED',
                retryAfter: error.retryAfter,
              },
            }],
          });
      }
      throw error;
    }
  }
});
```

---

### 4. Secure Cursor Pagination

**Implementation:** Opaque, signed cursors using HMAC

**Current (Insecure):**
```typescript
const cursor = Buffer.from('10').toString('base64'); // "MTA="
```

**New (Secure):**
```typescript
// apps/gateway/src/services/cursor.service.ts

import crypto from 'node:crypto';

@injectable()
export class CursorService {
  private readonly secret: string;
  
  constructor(@inject('config') config: Config) {
    this.secret = config.cursorSecret; // From env: CURSOR_SECRET
  }
  
  /**
   * Encode offset into opaque cursor with HMAC signature
   */
  encode(offset: number): string {
    const payload = JSON.stringify({ offset, timestamp: Date.now() });
    const signature = crypto
      .createHmac('sha256', this.secret)
      .update(payload)
      .digest('hex');
    
    const cursor = Buffer.from(JSON.stringify({
      payload,
      signature,
    })).toString('base64url'); // Use base64url (no padding, URL-safe)
    
    return cursor;
  }
  
  /**
   * Decode cursor and verify signature
   */
  decode(cursor: string): number {
    try {
      const decoded = JSON.parse(
        Buffer.from(cursor, 'base64url').toString('utf-8')
      );
      
      const { payload, signature } = decoded;
      
      // Verify signature
      const expectedSignature = crypto
        .createHmac('sha256', this.secret)
        .update(payload)
        .digest('hex');
      
      if (signature !== expectedSignature) {
        throw new Error('Invalid cursor signature');
      }
      
      const { offset, timestamp } = JSON.parse(payload);
      
      // Optional: Check cursor age (prevent replay attacks)
      const age = Date.now() - timestamp;
      if (age > 24 * 60 * 60 * 1000) { // 24 hours
        throw new Error('Cursor expired');
      }
      
      return offset;
    } catch (error) {
      throw new InvalidCursorError('Invalid or expired cursor');
    }
  }
}
```

**Resolver Integration:**
```typescript
// apps/gateway/src/graphql/resolvers.ts

constructor(
  @inject(WallpaperRepository) private readonly repository: WallpaperRepository,
  @inject(CursorService) private readonly cursorService: CursorService,
  @inject('config') private readonly config: Config
) {}

private async searchWallpapers(args: SearchArgs) {
  // Decode cursors
  let offset = 0;
  if (args.after) {
    offset = this.cursorService.decode(args.after);
  } else if (args.before) {
    offset = this.cursorService.decode(args.before);
  }
  
  // ... search logic
  
  // Encode cursors
  const startCursor = edges.length > 0 
    ? this.cursorService.encode(offset) 
    : null;
  const endCursor = edges.length > 0
    ? this.cursorService.encode(offset + edges.length)
    : null;
  
  return {
    edges,
    pageInfo: {
      hasNextPage,
      hasPreviousPage,
      startCursor,
      endCursor,
    },
  };
}
```

---

## Implementation Phases

### Phase 1: Query Depth Limiting (Week 1, Day 1-2)

**Tasks:**
1. Add `graphql-depth-limit` dependency
2. Configure max depth (5 levels)
3. Add validation rule to Mercurius
4. Write integration tests
5. Update OpenAPI docs with error responses

**Acceptance Criteria:**
- [ ] Queries exceeding depth 5 are rejected
- [ ] Error response follows GraphQL spec
- [ ] Tests verify depth enforcement
- [ ] Telemetry tracks rejected queries

---

### Phase 2: Query Complexity Analysis (Week 1, Day 3-5)

**Tasks:**
1. Add `graphql-query-complexity` dependency
2. Define complexity costs for schema
3. Implement custom complexity estimator
4. Add validation rule to Mercurius
5. Write integration tests with varying complexity
6. Add Grafana dashboard for query complexity

**Acceptance Criteria:**
- [ ] Queries exceeding complexity 1000 are rejected
- [ ] Costs accurately reflect query expense
- [ ] Telemetry records complexity per query
- [ ] Dashboard shows complexity distribution

---

### Phase 3: Rate Limiting (Week 2, Day 1-3)

**Tasks:**
1. Create `GraphQLRateLimitService`
2. Reuse Redis Lua script from Ingestor
3. Add preHandler hook for rate limit check
4. Implement rate limit headers
5. Write integration tests
6. Add rate limit metrics to Grafana

**Acceptance Criteria:**
- [ ] IP-based rate limiting works (100 req/min)
- [ ] Rate limit headers present in responses
- [ ] 429 responses follow GraphQL error format
- [ ] Redis stores rate limit state atomically
- [ ] Tests verify rate limit enforcement

---

### Phase 4: Secure Cursors (Week 2, Day 4-5)

**Tasks:**
1. Create `CursorService` with HMAC signing
2. Generate cursor secret (add to .env)
3. Update `searchWallpapers` resolver
4. Migrate existing cursors (backward compat)
5. Write unit and integration tests
6. Document cursor format

**Acceptance Criteria:**
- [ ] Cursors are opaque and signed
- [ ] Invalid cursors return clear errors
- [ ] Expired cursors (>24h) are rejected
- [ ] Backward compatibility with old cursors (during migration)
- [ ] Tests verify signature validation

---

## Testing Strategy

### Unit Tests

```typescript
// apps/gateway/test/unit/cursor.service.test.ts

describe('CursorService', () => {
  it('should encode and decode offsets', () => {
    const cursor = cursorService.encode(42);
    const offset = cursorService.decode(cursor);
    expect(offset).toBe(42);
  });
  
  it('should reject tampered cursors', () => {
    const cursor = cursorService.encode(42);
    const tampered = cursor.slice(0, -4) + 'XXXX'; // Modify signature
    expect(() => cursorService.decode(tampered)).toThrow(InvalidCursorError);
  });
  
  it('should reject expired cursors', () => {
    const oldCursor = createCursorWithTimestamp(Date.now() - 25 * 60 * 60 * 1000);
    expect(() => cursorService.decode(oldCursor)).toThrow('Cursor expired');
  });
});
```

### Integration Tests

```typescript
// apps/gateway/test/integration/graphql-security.test.ts

describe('GraphQL Security', () => {
  describe('Depth Limiting', () => {
    it('should reject queries exceeding max depth', async () => {
      // Query with 6 levels (exceeds limit of 5)
      const deepQuery = `
        query {
          searchWallpapers {
            edges {
              node {
                variants {
                  # Would need deeper nesting, but schema doesn't allow
                }
              }
            }
          }
        }
      `;
      
      const response = await tester.graphql(deepQuery);
      expect(response.status).toBe(400);
      expect(response.body.errors[0].message).toContain('maximum depth');
    });
  });
  
  describe('Complexity Analysis', () => {
    it('should reject overly complex queries', async () => {
      const complexQuery = `
        query {
          searchWallpapers(first: 1000) {
            edges {
              node {
                wallpaperId
                variants {
                  width height format url fileSizeBytes
                }
              }
            }
          }
        }
      `;
      
      const response = await tester.graphql(complexQuery);
      expect(response.status).toBe(400);
      expect(response.body.errors[0].extensions.code).toBe('COMPLEXITY_LIMIT_EXCEEDED');
    });
  });
  
  describe('Rate Limiting', () => {
    it('should enforce rate limits per IP', async () => {
      const query = '{ searchWallpapers { edges { node { wallpaperId } } } }';
      
      // Send 101 requests (limit is 100)
      for (let i = 0; i < 101; i++) {
        const response = await tester.graphql(query);
        if (i < 100) {
          expect(response.status).toBe(200);
          expect(response.headers['x-ratelimit-remaining']).toBe(String(100 - i - 1));
        } else {
          expect(response.status).toBe(429);
          expect(response.body.errors[0].extensions.code).toBe('RATE_LIMIT_EXCEEDED');
        }
      }
    });
  });
  
  describe('Cursor Security', () => {
    it('should reject invalid cursors', async () => {
      const query = `
        query {
          searchWallpapers(after: "invalid_cursor") {
            edges { node { wallpaperId } }
          }
        }
      `;
      
      const response = await tester.graphql(query);
      expect(response.status).toBe(400);
      expect(response.body.errors[0].message).toContain('Invalid cursor');
    });
  });
});
```

---

## Configuration

### Environment Variables

```bash
# apps/gateway/.env.example

# GraphQL Security
GRAPHQL_MAX_DEPTH=5
GRAPHQL_MAX_COMPLEXITY=1000

# Rate Limiting
RATE_LIMIT_ENABLED=true
RATE_LIMIT_MAX_ANONYMOUS=100      # Requests per window (anonymous)
RATE_LIMIT_MAX_AUTHENTICATED=500  # Requests per window (authenticated users)
RATE_LIMIT_WINDOW_MS=60000        # 1 minute

# Cursor Security
CURSOR_SECRET=<generate-random-secret-here>  # Use: openssl rand -hex 32
```

### Config Schema

```typescript
// apps/gateway/src/config.ts

const ConfigSchema = z.object({
  // ... existing fields
  
  // GraphQL Security
  graphqlMaxDepth: z.number().int().positive().default(5),
  graphqlMaxComplexity: z.number().int().positive().default(1000),
  
  // Rate Limiting
  rateLimitEnabled: z.boolean().default(true),
  rateLimitMaxAnonymous: z.number().int().positive().default(100),
  rateLimitMaxAuthenticated: z.number().int().positive().default(500),
  rateLimitWindowMs: z.number().int().positive().default(60000),
  
  // Cursor Security
  cursorSecret: z.string().min(32), // Required, must be strong
});
```

---

## Telemetry

### Metrics to Add

```typescript
// Query depth
recordHistogram('graphql.query.depth', depth, {
  operation: operationName,
});

// Query complexity
recordHistogram('graphql.query.complexity', complexity, {
  operation: operationName,
});

// Rejected queries
recordCounter('graphql.query.rejected', 1, {
  reason: 'depth_exceeded' | 'complexity_exceeded' | 'rate_limited',
});

// Rate limit state
recordGauge('graphql.ratelimit.remaining', remaining, {
  ip: hashIp(ip), // Hash for privacy
});
```

### Grafana Dashboard

**Panel: Query Complexity Distribution**
- Histogram of query complexity over time
- Alert if P95 > 800

**Panel: Rejected Queries**
- Counter by rejection reason
- Alert if rejection rate > 5%

**Panel: Rate Limit Status**
- Current rate limit usage by IP
- Alert if >80% of IPs are rate limited

---

## Security Considerations

### 1. DoS Protection

**Mitigation:**
- Query depth limit prevents stack overflow
- Complexity analysis prevents expensive queries
- Rate limiting prevents flooding

### 2. Cursor Security

**Mitigation:**
- HMAC signature prevents tampering
- Timestamp prevents replay attacks
- Base64url encoding prevents URL issues

### 3. Information Disclosure

**Current Issue:** Error messages might leak internal details

**Mitigation:**
```typescript
// Generic error for production
if (config.nodeEnv === 'production') {
  return {
    errors: [{
      message: 'Query validation failed',
      extensions: { code: error.code },
    }],
  };
}
// Detailed errors for development
return {
  errors: [{
    message: error.message,
    extensions: { ...error.extensions },
  }],
};
```

---

## Performance Impact

### Expected Overhead

- **Depth Limiting:** ~0.1ms per query (negligible)
- **Complexity Analysis:** ~1-5ms per query (acceptable)
- **Rate Limiting:** ~1ms per query (Redis roundtrip)
- **Cursor Signing:** ~0.5ms per cursor (HMAC is fast)

**Total:** ~2-7ms overhead per query (acceptable for security benefit)

---

## Backward Compatibility

### Cursor Migration

**Problem:** Existing clients may have old base64 cursors

**Solution:** Support both formats during transition period

```typescript
decode(cursor: string): number {
  try {
    // Try new format first (HMAC-signed)
    return this.decodeSecure(cursor);
  } catch {
    // Fall back to old format (base64 integer)
    return this.decodeLegacy(cursor);
  }
}

private decodeLegacy(cursor: string): number {
  // DEPRECATED: Remove after 30 days
  const offset = parseInt(Buffer.from(cursor, 'base64').toString(), 10);
  
  // Log migration warning
  this.logger.warn('Legacy cursor format detected', { cursor });
  
  return offset;
}
```

**Migration Timeline:**
- Week 1-4: Support both formats
- Week 4: Deprecation warning in logs
- Week 8: Remove legacy support

---

## Success Criteria

- [ ] All queries pass depth validation
- [ ] Complex queries are rejected with clear errors
- [ ] Rate limiting enforces 100 req/min per IP
- [ ] Cursors are cryptographically secure
- [ ] Zero false positives (legitimate queries not rejected)
- [ ] Performance overhead < 10ms per query
- [ ] All integration tests pass
- [ ] Grafana dashboard shows security metrics
- [ ] Documentation updated

---

## Files to Create/Modify

### New Files

```
apps/gateway/src/
├── graphql/
│   ├── complexity.ts              # Complexity cost configuration
│   └── validation-rules.ts        # Custom validation rules
├── services/
│   ├── cursor.service.ts          # Secure cursor encoding/decoding
│   └── rate-limit.service.ts      # GraphQL rate limiting
└── errors/
    └── graphql-errors.ts          # Custom GraphQL error classes

apps/gateway/test/
├── unit/
│   └── cursor.service.test.ts
└── integration/
    └── graphql-security.test.ts
```

### Modified Files

```
apps/gateway/src/
├── app.ts                          # Add validation rules, rate limit hook
├── config.ts                       # Add security configuration
└── graphql/resolvers.ts            # Use CursorService

apps/gateway/
├── .env.example                    # Add security config
└── package.json                    # Add dependencies
```

---

## Dependencies to Add

```json
{
  "graphql-depth-limit": "^1.1.0",
  "graphql-query-complexity": "^0.12.0"
}
```

---

## Related Plans

- [Input Validation and Injection Prevention](./input-validation-injection-prevention.md)
- [Monitoring and Alerting Improvements](./monitoring-alerting-improvements.md)
- [Authentication and Authorization](./authentication-authorization.md) (future)

---

## References

- [GraphQL Best Practices: Security](https://graphql.org/learn/best-practices/#security)
- [OWASP GraphQL Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/GraphQL_Cheat_Sheet.html)
- [Shopify GraphQL Rate Limiting](https://shopify.dev/api/usage/rate-limits)
