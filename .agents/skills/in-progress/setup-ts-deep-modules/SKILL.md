---
name: setup-ts-deep-modules
description: Wire dependency-cruiser into a TypeScript repo so each package is a deep module, with implementation hidden in subfolders and reachable only through its entry-point files. User-invoked.
disable-model-invocation: true
---

# Setup TS Deep Modules

Install [dependency-cruiser](https://github.com/sverweij/dependency-cruiser) so packages expose root files as entry points and hide subfolder implementation. Invoke `codebase-design` for its vocabulary.

## The shape this enforces

```text
src/packages/
  <name>/
    index.ts        # Public entry point
    client.ts       # Another public entry point
    lib/            # Private implementation
    tests/          # Tests and fixtures
```

Every root file is public; every subfolder is private, regardless of its name. Prefer several small entry points over a barrel re-exporting an entire subtree.

Enforce four rules at `error` severity:

1. Outside code may import only a package's root files.
2. A package's own implementation may import its files freely.
3. Files under `<pkg>/tests/` may import any package's entry points and their own test fixtures, but no package's subfolder internals, including their own. Cross-package integration tests are allowed.
4. Dependency cycles are forbidden.

Leave package layering as a commented stub for the repository to configure.

## Steps

### 1. Detect the environment

- Select pnpm from `pnpm-lock.yaml`, yarn from `yarn.lock`, bun from `bun.lockb`, or npm otherwise. Use the selected manager throughout.
- Use `src/packages` if `src/` exists, otherwise `packages`. Confirm with the user if the repository has another clear convention.
- Check for `.dependency-cruiser.*`. Merge into existing configuration rather than overwriting it, and report the additions.

### 2. Install dependency-cruiser

Add `dependency-cruiser` to devDependencies with the selected package manager.

### 3. Write the config

Copy [`dependency-cruiser.config.cjs`](./dependency-cruiser.config.cjs) to `.dependency-cruiser.cjs` at the repository root, or merge its rules and options into the existing configuration. Set `PACKAGES_ROOT` to the detected root and retain all four rules. They use path depth and do not depend on file extensions.

### 4. Wire it into the checks

Add `lint:boundaries` using `depcruise <packages-root>` or `depcruise src`. Include it in the umbrella command that runs typecheck. If none exists, tell the user to include it in CI. Do not change `tsconfig` or add path aliases.

### 5. Scaffold the example package

Create a committed `<packages-root>/example/` template:

- `index.ts` exports a function that delegates to `lib/impl.ts`.
- `lib/impl.ts` contains private implementation.
- `tests/example.test.ts` imports only `../index` and checks the public function.

Tell the user they may copy or delete this starter template.

### 6. Prove the rules bite

1. Run `lint:boundaries` and require a pass on the clean example.
2. Temporarily add a deep import to `tests/example.test.ts`, such as `import { thing } from "../lib/impl"`. Require failure with `tests-through-entrypoints`.
3. Remove the import and require a pass again.

Do not finish until all three outcomes have been observed. Fix configuration or wiring if the deep import passes.

### 7. Document the convention

Write `<packages-root>/README.md` with the layout above, one paragraph per rule, and the `lint:boundaries` command. State that imports use root entry points and discourage barrels in favor of several small entry points.

Link it from `CLAUDE.md`, or `AGENTS.md` if absent. Create `AGENTS.md` if neither exists. The pointer must tell agents to read the convention before adding or importing packages.

## Notes

- Preserve the config's `$1` group back-references; they distinguish a package's own imports from outsiders. Do not replace them with per-package rules.
- Packages are immediate children of the packages root. Implementation may nest arbitrarily, but packages cannot contain packages.
- Use `.cjs` so `module.exports` works in repositories with `"type": "module"`.
