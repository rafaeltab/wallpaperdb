---
name: scaffold-exercises
description: Create exercise directory structures with sections, problems, solutions, and explainers that pass linting. Use when user wants to scaffold exercises, create exercise stubs, or set up a new course section.
---

# Scaffold Exercises

Create exercise directories that pass `pnpm ai-hero-cli internal lint`, then commit with `git commit`.

## Directory naming

Use lowercase dash-case names under `exercises/`:

- Sections: `XX-section-name/`.
- Exercises: `XX.YY-exercise-name/` within section `XX`.

## Exercise variants

Each exercise needs at least one variant:

- `problem/`: student workspace with TODOs.
- `solution/`: reference implementation.
- `explainer/`: conceptual material without TODOs.

Default stubs to `explainer/` unless the plan says otherwise.

## Required files

Every variant needs a nonempty `readme.md` with working links. For stubs, use a title and description. Variants containing code also need a `main.ts` with more than one line; readme-only stubs are allowed.

## Workflow

1. Extract sections, exercises, and variant types from the plan.
2. Create their directories and stub readmes.
3. Run `pnpm ai-hero-cli internal lint` and fix errors until it passes.

## Lint rules summary

The linter also requires:

- At least one `problem/`, `explainer/`, or `explainer.1/` per exercise.
- No `.gitkeep` or `speaker-notes.md` files.
- No `pnpm run exercise` commands in readmes.

## Moving/renaming exercises

Use `git mv`, update numeric prefixes to preserve ordering, and rerun lint.

## Example: stubbing from a plan

For exercise `05.02 Short-term Memory` with all three variants, create:

```sh
mkdir -p exercises/05-memory-skill-building/05.02-short-term-memory/{explainer,problem,solution}
```

Add a `readme.md` titled `# Short-term Memory` with a description in each variant.
