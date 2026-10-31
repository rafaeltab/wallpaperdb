---
name: code-review
description: "Review the changes since a fixed point (commit, branch, tag, or merge-base) along two axes: Standards (does the code follow this repo's documented coding standards?) and Spec (does the code match what the originating issue/spec asked for?). Runs required reviews in separate sub-agents and reports both axes side by side. Use when the user wants to review a branch, a PR, work-in-progress changes, or asks to \"review since X\"."
---

Two-axis review of the diff between `HEAD` and a fixed point the user supplies:

- **Standards**: does the code conform to this repo's documented coding standards?
- **Spec**: does the code faithfully implement the originating issue / spec?

Each axis requiring fresh review runs in a separate sub-agent. When both are needed, run them in parallel, then aggregate their findings alongside any retained evidence.

Apply [task scope](../../../../docs/agents/task-scope.md) when preparing both sub-agent briefs and interpreting their findings. Include the agreed scope, relevant user decisions, and pending proposals in each brief, including repeated rounds.

The issue tracker should have been provided to you. If `docs/agents/issue-tracker.md` is missing, tell the user to run `/setup-matt-pocock-skills`.

## Process

### 1. Pin the fixed point

Whatever the user said is the fixed point (a commit SHA, branch name, tag, `main`, `HEAD~5`, etc.). If they didn't specify one, ask for it.

Capture the diff command once: `git diff <fixed-point>...HEAD` (three-dot, so the comparison is against the merge-base). Also note the list of commits via `git log <fixed-point>..HEAD --oneline`.

Record each axis's comparison and result. For reviewed-work or base-branch changes, assess earlier reviews before dispatching reviewers. Carry forward equivalent evidence with its original provenance; run the affected axes on material or unresolved changes and their interactions. A first review still runs both axes below.

Before going further, confirm the fixed point resolves (`git rev-parse <fixed-point>`) and the diff is non-empty. A bad ref or empty diff should fail here, not inside two parallel sub-agents.

### 2. Identify the spec source

Use originating requirements supplied by the invoking workflow or established in the current conversation as the spec source. When $do-work invokes this review, use its recorded requirements and starting comparison. Follow their issue or document references for supporting context.

If requirements are not already available, look for the originating spec in this order:

1. Issue references in the commit messages (`#123`, `Closes #45`, GitLab `!67`, etc.), fetched via the workflow in `docs/agents/issue-tracker.md`.
2. A path the user passed as an argument.
3. A spec file under `docs/`, `specs/`, or `.scratch/` matching the branch name or feature.
4. If nothing is found, ask the user where the spec is. If they say there isn't one, the **Spec** sub-agent will skip and report "no spec available".

When production behavior, tests, or test helpers change, gather the full affected public implementation, owning test suites, helpers, port contracts, and originating issue comments. Follow references to surrounding tests before claiming coverage is absent. Gather this context directly from the repository and issue tracker; the user does not need to assemble a review packet. Give the relevant paths and requirements to both sub-agents.

### 3. Identify the standards sources

Use the repository root's [coding guidelines index](../../../../CODING_STANDARDS.md) to select all guidelines applicable to the changes under review. Follow contextual links when the change touches their stated scope. Skills and contribution guides govern their respective workflows; existing implementation examples and historical plans do not add coding standards.

For defect-fixing diffs, include [defect verification](../../wallpaperdb/testing/SKILL.md#verify-defect-fixes) in the workflow sources supplied to both reviewers.

On top of whatever the repo documents, the Standards axis always carries the **smell baseline** below: a fixed set of Fowler code smells (_Refactoring_, ch.3) that applies even when a repo documents nothing. Two rules bind it:

- **The repo overrides.** A documented repo standard always wins; where it endorses something the baseline would flag, suppress the smell.
- **Always a judgement call.** Each smell is a labelled heuristic ("possible Feature Envy"), never a hard violation. Like any standard here, skip anything tooling already enforces.

Each smell reads *what it is* → *how to fix*; match it against the diff:

- **Mysterious Name**: a function, variable, or type whose name doesn't reveal what it does or holds. → rename it; if no honest name comes, the design's murky.
- **Duplicated Code**: the same logic shape appears in more than one hunk or file in the change. → extract the shared shape, call it from both.
- **Feature Envy**: a method that reaches into another object's data more than its own. → move the method onto the data it envies.
- **Data Clumps**: the same few fields or params keep travelling together (a type wanting to be born). → bundle them into one type, pass that.
- **Primitive Obsession**: a primitive or string standing in for a domain concept that deserves its own type. → give the concept its own small type.
- **Repeated Switches**: the same `switch`/`if`-cascade on the same type recurs across the change. → replace with polymorphism, or one map both sites share.
- **Shotgun Surgery**: one logical change forces scattered edits across many files in the diff. → gather what changes together into one module.
- **Divergent Change**: one file or module is edited for several unrelated reasons. → split so each module changes for one reason.
- **Speculative Generality**: abstraction, parameters, or hooks added for needs the spec doesn't have. → delete it; inline back until a real need shows.
- **Message Chains**: long `a.b().c().d()` navigation the caller shouldn't depend on. → hide the walk behind one method on the first object.
- **Middle Man**: a class or function that mostly just delegates onward. → cut it, call the real target direct.
- **Refused Bequest**: a subclass or implementer that ignores or overrides most of what it inherits. → drop the inheritance, use composition.

### 4. Dispatch axes requiring fresh review

Use the applicability decisions from step 1. Spawn one sub-agent per axis requiring fresh review, in parallel when both are needed. On repeated reviews, skip axes whose retained evidence applies. If neither needs fresh review, proceed to step 5 with the retained evidence.

**Standards sub-agent prompt** should include:

- The full diff command and commit list.
- The list of standards-source files you found in step 3, **plus the smell baseline from step 3** pasted in full (the sub-agent has no other access to it).
- The brief: "Report, per file/hunk where relevant, (a) every place the diff violates a documented standard: cite the standard (file + the rule); and (b) any baseline smell you spot: name it and quote the hunk. Distinguish hard violations from judgement calls: documented-standard breaches can be hard, but baseline smells are always judgement calls, and a documented repo standard overrides the baseline. Skip anything tooling enforces. Under 400 words."

**Spec sub-agent prompt** should include:

- The diff command and commit list.
- The path or fetched contents of the spec.
- The brief: "Report: (a) requirements the spec asked for that are missing or partial; (b) behaviour in the diff that wasn't asked for (scope creep); (c) requirements that look implemented but where the implementation looks wrong. Quote the spec line for each finding. Under 400 words."

- For affected behavior, also assess the owning tests against the shared and subject-specific testing principles. For a test-quality finding, cite its assertion or missing case, the supporting requirement, and a plausible incorrect outcome the suite would accept or an unnecessary implementation dependency. Check surrounding independent encode/decode cases before criticizing a round trip. Distinguish explicit stability, idempotency, and input-preservation comparisons from circular expectations. Source text, serialized output and interactions may themselves be public contracts. Report supported defects and unresolved evidence gaps separately; a clean result is valid, and numerical readability limits or a finding quota are not review goals.

If the spec is missing, skip the Spec sub-agent and note this in the final report.

### 5. Aggregate

Report both axes under `## Standards` and `## Spec` headings. For a newly reviewed axis, present its report verbatim or lightly cleaned. For a skipped axis, identify the retained result, actual reviewed comparison, and applicability assessment for the current comparison; summarize its outcome without claiming a new review. Mark a missing-spec axis as skipped. Do **not** merge or rerank findings, because the two axes are deliberately separate (see _Why two axes_).

End with a one-line summary: total findings per axis, and the worst issue _within each axis_ (if any). Don't pick a single winner across axes: that's the reranking the separation exists to prevent.

## Why two axes

A change can pass one axis and fail the other:

- Code that follows every standard but implements the wrong thing → **Standards pass, Spec fail.**
- Code that does exactly what the issue asked but breaks the project's conventions → **Spec pass, Standards fail.**

Reporting them separately stops one axis from masking the other.
