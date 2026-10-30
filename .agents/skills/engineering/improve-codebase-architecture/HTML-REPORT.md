# HTML report format

Write one self-contained HTML report in the OS temp directory. Use Tailwind and Mermaid from CDNs. Mermaid suits dependencies, call graphs, and sequences; use divs or inline SVG for cross-sections and other layouts it cannot express clearly.

## Scaffold

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Architecture review for {{repo name}}</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script type="module">
      import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";
      mermaid.initialize({ startOnLoad: true, theme: "neutral", securityLevel: "loose" });
    </script>
  </head>
  <body class="bg-stone-50 text-slate-900 font-sans">
    <main class="max-w-5xl mx-auto px-6 py-12 space-y-12">
      <header>...</header>
      <section id="candidates" class="space-y-10">...</section>
      <section id="top-recommendation">...</section>
    </main>
  </body>
</html>
```

## Header

Show repository name, date, and a compact legend: solid box for a module, dashed line for a seam, red arrow for leakage, thick dark box for a deep module. Omit an introduction.

## Candidate card

Use one `<article>` per candidate with:

- A short title naming the deepening.
- Recommendation badge: `Strong` in emerald, `Worth exploring` in amber, or `Speculative` in slate. Tag its dependency category: `in-process`, `local-substitutable`, `ports & adapters`, or `mock`.
- Files in `font-mono text-sm`.
- Before and after diagrams in adjacent columns.
- One sentence each for the problem and solution.
- Benefits in bullets of at most six words, naming specific gains in locality, leverage, or testing.
- An amber one-line ADR conflict callout when applicable.

Keep prose sparse. Redraw diagrams that need paragraphs to explain them.

## Diagram patterns

Choose and vary patterns according to what each candidate needs to show.

### Mermaid graph (the workhorse for dependencies / call flow)

Use a flowchart for calls or dependencies, styled with red leakage edges and dark deep modules. Use sequences to compare round trips. Wrap diagrams in styled cards.

### Hand-built boxes-and-arrows (when Mermaid's layout fights you)

Use labeled, bordered divs with absolutely positioned SVG arrows. Show internal details faded inside the deep module.

### Cross-section (good for layered shallowness)

Compare several thin horizontal bands with one thick band labeled with the consolidated responsibility.

### Mass diagram (good for "interface as wide as implementation")

Use paired interface and implementation rectangles. In a shallow module their heights are similar; in a deep one the interface is short and implementation tall.

### Call-graph collapse

Compare a tree of calls with one box containing the now-internal calls faded inside it.

## Style guidance

- Use generous whitespace and restrained color: one accent, red leakage, and amber warnings.
- Keep diagrams around 320px tall for side-by-side comparison.
- Use `text-xs uppercase tracking-wider` for module labels.
- Include only the Tailwind CDN and Mermaid import as scripts. Keep the rest static.

## Top recommendation section

Show the chosen candidate, one sentence explaining why, and a link to its card.

## Tone

Use plain English and the exact [codebase-design vocabulary](../codebase-design/SKILL.md#glossary): module, interface, implementation, depth, deep, shallow, seam, adapter, leverage, and locality. Describe concrete benefits rather than generic claims of cleaner or more maintainable code.
