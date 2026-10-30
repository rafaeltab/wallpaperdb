---
name: wayfinder
description: Plan a huge chunk of work (more than one agent session can hold) as a shared map of decision tickets on your issue tracker, and resolve them one at a time until the way to the destination is clear.
disable-model-invocation: true
---

Plan an effort too large for one session by keeping a shared map of decision tickets on the issue tracker. Resolve questions until the route to the destination is clear.

## Plan, don't do

Each ticket resolves a decision. Produce deliverables only if the effort explicitly overrides this planning default in its Notes. Otherwise hand off once nothing remains to decide.

## Refer by name

Use linked map and ticket titles in human-facing text, rather than bare numbers, IDs, or slugs.

## The Map

Keep one issue labeled `wayfinder:map`, with child issues as tickets. The map indexes decisions with short summaries and links; their details live in the tickets.

Consult the configured tracker document's "Wayfinding operations" for map, ticket, dependency, and query operations. If the tracker was not provided, tell the user to run `/setup-matt-pocock-skills` and default to the local Markdown tracker.

### The map body

Load this overview once per session. Find open tickets by querying children; do not list them in the body.

```markdown
## Destination

<The spec, decision, or change this effort is planning toward. One or two lines.>

## Notes

<Domain, required skills, standing preferences, and any execution override.>

## Decisions so far

- [<closed ticket title>](link): <one-line summary of the answer>

## Not yet specified

<In-scope questions that cannot yet be stated precisely enough to ticket.>

## Out of scope

<Excluded work, with reasons and links to any closed tickets.>
```

### Tickets

Size each child issue to one 100K-token agent session. Its body states the question:

```markdown
## Question

<The decision or investigation to resolve.>
```

Use only `wayfinder:` labels on maps and tickets. Each ticket has one type label: `wayfinder:research`, `wayfinder:prototype`, `wayfinder:grilling`, or `wayfinder:task`. Do not apply implementation triage labels such as `ready-for-agent`.

Before work, claim a ticket by assigning it to the developer driving the map. An open, unassigned ticket is unclaimed.

Use native blocking relationships when available so the frontier is visible in the tracker; otherwise use its body convention. A ticket is unblocked when all blockers are closed. The frontier contains open, unblocked, unclaimed children.

Record answers in resolution comments rather than the ticket body. Link created assets from the issue instead of pasting them in.

## Ticket Types

HITL tickets require a live exchange with a human. Never supply the human's answers yourself. AFK tickets run without human steering.

- **Research, AFK.** A subagent uses `research` to establish facts from outside the working directory.
- **Prototype, HITL.** Use `prototype` to create a rough artifact for feedback about appearance or behavior. Link it as an asset.
- **Grilling, HITL.** The default. Load both `grilling` and `domain-modeling`.
- **Task, HITL or AFK.** Perform work needed to unblock a decision, such as provisioning access or moving data for inspection. The agent performs it when possible; otherwise give the human a precise checklist. Record completion and resulting facts that later tickets need, such as credential locations, URLs, or row counts. This type unblocks a decision rather than delivering the destination.

## Fog of war

Keep in-scope questions that cannot yet be stated precisely in **Not yet specified**. As decisions clarify them, create tickets and remove the corresponding notes. A precise question belongs in a ticket even when blocked or unanswered. A vague area may later produce several tickets or none; do not split it prematurely.

Exclude resolved decisions, existing tickets, and out-of-scope work from this section.

## Out of scope

The destination defines scope. Record work beyond it under **Out of scope**, not **Not yet specified**. It returns only through a redrawn destination and a fresh effort, not a resumption.

If an existing ticket proves out of scope, close it and add a linked summary and reason under **Out of scope**. Do not add it to **Decisions so far**.

## Invocation

Resolve at most one ticket per session, except research tickets.

### Chart the map

When invoked with a loose idea:

1. Load `grilling` and `domain-modeling` to define the destination and scope first.
2. Interview breadth first to identify open decisions and available first steps. If the route is already clear and small enough for one session, stop and ask how the user wants to proceed.
3. Create the map with Destination and Notes, empty Decisions-so-far, and unresolved areas under Not yet specified.
4. Create all currently specifiable child tickets, then wire dependencies and cross-references in a second pass using real IDs. Placeholder issue numbers can link unrelated issues.
5. Launch parallel research subagents for research tickets. Each uses `research`, captures findings on a throwaway `research/<name>` branch, pushes it, and links it from the ticket. Open no PR; the branch is never merged.
6. Stop. Charting does not resolve other tickets in the same session.

### Work through the map

When invoked with a map URL or number:

1. Load the map overview, without loading every ticket.
2. Use the named ticket, or select the first frontier ticket in order. Claim it before work.
3. Read its type label and resolve it accordingly. Fetch related ticket bodies only as needed and load skills named in Notes. If uncertain, load `grilling` and `domain-modeling`.
4. Post the answer as a resolution comment, close the issue, and append a linked summary under Decisions-so-far.
5. Create and then wire newly specified tickets; remove graduated notes. Close newly discovered out-of-scope tickets under the scope rules. Update or delete other tickets invalidated by the decision.
6. When the route is clear and no decision tickets remain, follow Spec handoff if the destination includes specs.

Other sessions may work unblocked tickets concurrently; account for their tracker edits.

### Spec handoff

Use the project's applicable `$to-spec` skill to publish each resulting spec, supplying relevant decision tickets and resolution comments as context. Link the specs and tell the user to run `$to-tickets` for each. Decision tickets do not replace implementation tickets.
