# UI prototype

Create structurally different UI variants on one route, selected by `?variant=` and a floating bottom bar. For logic or state questions, use [LOGIC.md](LOGIC.md).

## When this is the right shape

Use it to compare layouts, information hierarchy, and primary interactions before choosing a design.

## Two sub-shapes: strongly prefer sub-shape A

Show variants within the real application's navigation, data, and density whenever possible.

### Sub-shape A: adjustment to an existing page (preferred)

Keep the existing route, parameters, data fetching, and auth. Swap only rendering through `?variant=`. New sections or flow steps that naturally belong in an existing page use that host too.

### Sub-shape B: a new page (last resort)

Use a new route only when no existing page can host the design. Follow the project's routing conventions and mark the path or file as a prototype. Use the same search parameter and switcher.

## Process

### 1. State the question and pick N

Default to 3 variants, at most 5. Record a one-line plan naming the route and selection parameter.

### 2. Generate radically different variants

Each variant follows the page's purpose, available data, and styling system, with a clear exported name such as `VariantA`.

Vary layout, information hierarchy, and primary interactions. Color or copy changes alone do not qualify. Redo drafts that are too similar. Shared headers are fine; a shared layout must not constrain every design.

### 3. Wire them together

Read `variant` from the URL, default to `A`, and render the matching component with the page data. Keep existing data fetching above this switch. Mount one shared `PrototypeSwitcher` on the route.

### 4. Build the floating switcher

Use a fixed bar at bottom center containing a previous arrow, the current variant key and optional name, and a next arrow.

- Wrap at either end.
- Update the search parameter through the framework router so variants survive reloads and can be shared.
- Support left and right arrow keys, except while an input, textarea, or contenteditable element is focused.
- Distinguish the bar visually from the design under review.
- Hide it in production builds with an environment check.

Place the shared switcher wherever shared UI belongs in the project.

### 5. Hand it over

Provide the URL and variant keys. Use feedback to choose a variant or combine parts.

### 6. Capture the answer and clean up

Record the winner and rationale, then follow [SKILL.md](SKILL.md) to preserve all variants on the throwaway branch.

For an existing page, integrate the winner and remove losing variants and the switcher from main. For a new page, promote the winner to a real route and remove the prototype route and switcher.

## Anti-patterns

Keep mutations stubbed; read-only use of real data is fine. Before production integration, rewrite the winning prototype with normal tests and error handling. Its prototype constraints are unsuitable for production.
