---
name: setup-pre-commit
description: Set up Husky pre-commit hooks with lint-staged (Prettier), type checking, and tests in the current repo. Use when user wants to add pre-commit hooks, set up Husky, configure lint-staged, or add commit-time formatting/typechecking/testing.
---

# Setup Pre-Commit Hooks

## What This Sets Up

Husky runs lint-staged with Prettier on staged files, then the repository's typecheck and test scripts.

## Steps

### 1. Detect package manager

Select npm, pnpm, yarn, or bun from the lockfile; default to npm if unclear. Adapt commands below to it.

### 2. Install dependencies

Add `husky`, `lint-staged`, and `prettier` as devDependencies.

### 3. Initialize Husky

```sh
npx husky init
```

This creates `.husky/` and sets the package's `prepare` script to `"husky"`.

### 4. Create `.husky/pre-commit`

Husky v9+ needs no shebang:

```sh
npx lint-staged
npm run typecheck
npm run test
```

Omit missing `typecheck` or `test` scripts and tell the user.

### 5. Create `.lintstagedrc`

```json
{
  "*": "prettier --ignore-unknown --write"
}
```

### 6. Create `.prettierrc` (if missing)

Preserve any existing Prettier config. Otherwise create:

```json
{
  "useTabs": false,
  "tabWidth": 2,
  "printWidth": 80,
  "singleQuote": false,
  "trailingComma": "es5",
  "semi": true,
  "arrowParens": "always"
}
```

### 7. Verify

Check that the hook exists and is executable, `.lintstagedrc` and Prettier config exist, and `prepare` is `"husky"`. Run `npx lint-staged`.

### 8. Commit

Stage all changed and created files, then commit with `Add pre-commit hooks (husky + lint-staged + prettier)`. This exercises the new hooks.

## Notes

`prettier --ignore-unknown` skips unsupported files, such as images.
