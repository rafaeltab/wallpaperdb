---
name: writing-shape
description: "Writing, exploit: shape raw material into an article, paragraph by paragraph."
disable-model-invocation: true
---

<what-to-do>

Read the user's raw-material Markdown file in full, whether it contains fragments, prose, or a transcript. Shape it into a separate article; the input file remains read-only. Exploration is finished: choose a structure from the supplied material.

Ask once for the article's save path if none was supplied.

</what-to-do>

<supporting-info>

## The loop

1. Read the entire input file.
2. Settle with the user which concepts the audience already knows. See [Grounding](#grounding).
3. Offer 2–3 openings with different theses or angles. Have the user choose or combine them; that choice determines the article's direction.
4. Ask what the reader needs next. Draw the next block from the raw material, using only grounded concepts. Discuss its format with the user.
5. Append each agreed block immediately.
6. Repeat step 4 until the user decides the article is done.

## Grounding

A **grounded** concept is one the reader already knew or an earlier block introduced. Track these concepts as the article grows. Introduce any concept before relying on it, including ideas without jargon. When a concept has a term, introduce both together.

If the next block requires an unintroduced concept, ground it first or revise an earlier block. Settle audience prerequisites with the user without excluding readers or filling the opening with definitions.

## Conversational feel

Challenge weak transitions, redundant paragraphs, sentences doing multiple jobs, and drift from the opening's promise. Ask what each block adds and whether its format helps the reader.

## Pulling from the pile

Split, combine, quote, or paraphrase fragments so the article reads in one voice. If necessary material is missing, name the gap and ask the user to supply it or cut the section.

## Format arguments to actually have

Discuss these choices with the user:

- Use prose for arguments and lists for parallel items.
- Use callouts such as `> [!TIP]` or `> [!NOTE]` for asides that would interrupt the argument.
- Use a table when the same fields repeat at least three times; otherwise use prose with bold leads.
- Quote when the wording matters; paraphrase when only the idea matters.
- Use code blocks for multiline, runnable, or illustrative code, and inline code for single identifiers.

## Writing rhythm

Append each agreed block immediately. Re-read the article before every write and preserve user edits. Rewrite only the requested paragraph, leaving the rest alone.

## Out of scope

- Seeking new fragments beyond the supplied material, except to resolve an identified gap.
- Editing the raw-material file.
- Publishing, platform-specific formatting, or unrequested frontmatter.

</supporting-info>
