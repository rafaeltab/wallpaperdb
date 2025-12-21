# GraphQL Security Hardening - Implementation Issue Summary

## Context

We are implementing GraphQL security hardening for the Gateway service (Mercurius-based GraphQL server) according to the plan in `plans/graphql-security-hardening.md`.

**Technology Stack:**
- **Fastify**: 5.2.0
- **Mercurius**: 16.6.0 (GraphQL adapter for Fastify)
- **GraphQL**: 16.12.0
- **Target packages** (per plan):
  - `graphql-depth-limit`: 1.1.0 (✅ installed)
  - `graphql-query-complexity`: 1.1.0 (✅ installed)

## What We Tried

### Approach 1: ValidationRules (Per Original Plan)

The plan specified using `validationRules` option when registering Mercurius:

```typescript
await fastify.register(mercurius, {
  schema,
  resolvers,
  validationRules: getValidationRules(), // Array of GraphQL validation rules
});
```

Where `getValidationRules()` returns:
```typescript
[
  depthLimit(5),  // From graphql-depth-limit
  createComplexityRule({ ... })  // From graphql-query-complexity
]
```

**Problem:** The validation rules are created but never executed. Logging shows:
- `getValidationRules()` is called once during app initialization
- The complexity estimator functions inside the rules are NEVER called during query execution
- Query complexity is always reported as 0
- Queries that should be rejected (1000+ items) pass through successfully

### Approach 2: Mercurius Hooks

After reading the Mercurius documentation, we tried using the `preValidation` hook:

```typescript
fastify.after(() => {
  fastify.graphql.addHook('preValidation', async (schema, document, context) => {
    const complexity = getComplexity({
      schema,
      query: document,
      variables: context.reply.request.body.variables || {},
      estimators: [simpleEstimator({ defaultComplexity: 1 })],
    });
    
    if (complexity > MAX_COMPLEXITY) {
      throw new Error('Query too complex');
    }
  });
});
```

**Problem:** This triggers a critical error:

```
Cannot use GraphQLObjectType "Query" from another module or realm.

Ensure that there is only one instance of "graphql" in the node_modules
directory. If different versions of "graphql" are the dependencies of other
relied on modules, use "resolutions" to ensure only one version is installed.
```

**Analysis:** Even though `pnpm why graphql` shows only version 16.12.0, the `graphql-query-complexity` package's `getComplexity()` function is comparing GraphQL type objects from different module instances, causing the realm check to fail.

## Core Issues

1. **ValidationRules Don't Execute**: The `validationRules` option in Mercurius appears to be for schema validation, not runtime query validation. The rules are created but never invoked during query execution.

2. **GraphQL Instance Conflicts**: Using `graphql-query-complexity` in Mercurius hooks causes "different realm" errors, suggesting the library isn't compatible with how Mercurius uses GraphQL internally.

3. **Plan Assumptions May Be Wrong**: The plan assumes we can use standard GraphQL.js validation rules with Mercurius, but Mercurius may:
   - Use a different validation mechanism (JIT compilation)
   - Require Mercurius-specific plugins or hooks
   - Not support runtime complexity analysis via validation rules

## What Works

- ✅ Query depth limiting via `graphql-depth-limit` (tests pass for queries within limits)
- ✅ Infrastructure setup (config files, test structure)
- ✅ Dependency installation

## What Doesn't Work

- ❌ Query complexity analysis (always shows 0, never rejects)
- ❌ Using `graphql-query-complexity` with Mercurius (realm errors)
- ❌ ValidationRules execution during query runtime

## Test Evidence

```typescript
// This query SHOULD be rejected (complexity >> 1000) but PASSES
query {
  searchWallpapers(first: 1000) {  // 1000 items
    edges {
      node {
        wallpaperId
        userId
        variants {  // Nested array
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

// Expected: 400 Bad Request with complexity error
// Actual: 200 OK with successful response
// Logged complexity: 0 (incorrect)
```

## Questions for New Plan

1. **Does Mercurius support runtime query complexity analysis?** Or does its JIT compilation approach prevent this?

2. **What's the correct way to integrate query complexity with Mercurius?** Is there:
   - A Mercurius-specific plugin?
   - A different hook we should use?
   - An alternative approach that doesn't use `graphql-query-complexity`?

3. **Should we implement custom complexity calculation?** Instead of using external libraries, should we:
   - Parse the query AST ourselves in a hook?
   - Use Mercurius-specific APIs?
   - Implement simpler pagination limits instead?

4. **Are there working examples?** Can you find:
   - Production Mercurius apps with query complexity limits?
   - Mercurius plugins that add security features?
   - Alternative approaches to preventing expensive queries?

## Files Modified

- `apps/gateway/package.json` - Added dependencies
- `apps/gateway/src/graphql/config.ts` - Depth limit config (NEW)
- `apps/gateway/src/graphql/complexity.ts` - Complexity costs config (NEW)
- `apps/gateway/src/graphql/validation-rules.ts` - Validation rules (NEW, doesn't work)
- `apps/gateway/src/graphql/security-hooks.ts` - Hook-based approach (NEW, causes errors)
- `apps/gateway/src/app.ts` - Attempted integration
- `apps/gateway/test/graphql-security.test.ts` - Comprehensive tests (NEW)

## Current State

The codebase is in a working state (app starts, existing tests pass) but the security features don't work. We need a fundamentally different approach that's compatible with how Mercurius actually works.

## References

- Mercurius GitHub: https://github.com/mercurius-js/mercurius
- Mercurius Hooks Docs: https://github.com/mercurius-js/mercurius/blob/master/docs/hooks.md
- Original Plan: `plans/graphql-security-hardening.md`
- Test File: `apps/gateway/test/graphql-security.test.ts`

## Recommendation

We need a new plan that:
1. Researches how Mercurius handles query validation (JIT vs validation rules)
2. Finds the correct integration pattern for Mercurius specifically
3. May use different libraries or a custom implementation
4. Validates the approach with a minimal working example before full implementation
