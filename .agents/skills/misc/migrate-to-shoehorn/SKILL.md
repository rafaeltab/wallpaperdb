---
name: migrate-to-shoehorn
description: Migrate test files from `as` type assertions to @total-typescript/shoehorn. Use when user mentions shoehorn, wants to replace `as` in tests, or needs partial test data.
---

# Migrate to Shoehorn

## Why shoehorn?

Use `@total-typescript/shoehorn` to replace type assertions in test data. It supports partial objects and intentionally invalid inputs without naming the target type.

Use it only in tests, never production code.

## Install

```sh
npm i @total-typescript/shoehorn
```

## Migration patterns

### Large objects with few needed properties

Supply only fields the test exercises:

```ts
import { fromPartial } from "@total-typescript/shoehorn";

getUser(fromPartial({ body: { id: "123" } }));
```

### `as Type` → `fromPartial()`

Replace `getUser({ body: { id: "123" } } as Request)` with the `fromPartial` call above.

### `as unknown as Type` → `fromAny()`

Use `fromAny` for deliberately invalid data:

```ts
import { fromAny } from "@total-typescript/shoehorn";

getUser(fromAny({ body: { id: 123 } }));
```

## When to use each

| Function | Use case |
| --- | --- |
| `fromPartial()` | Partial data that still type-checks |
| `fromAny()` | Intentionally invalid data, with autocomplete |
| `fromExact()` | Complete object, replaceable with `fromPartial` later |

## Workflow

1. Ask which tests need migration, whether they need partial objects, and whether they test invalid data.
2. Install the package and find assertions in `*.test.ts` and `*.spec.ts` files.
3. Apply the replacements above, add imports, and run type checking.
