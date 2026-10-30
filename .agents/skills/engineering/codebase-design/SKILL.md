---
name: codebase-design
description: Shared vocabulary for designing deep modules. Use when the user wants to design or improve a module's interface, find deepening opportunities, decide where a seam goes, make code more testable or AI-navigable, or when another skill needs the deep-module vocabulary.
---

# Codebase design

Design deep modules: substantial behavior behind a small interface, at a seam tests can exercise. Use the terms below consistently when designing or restructuring code.

## Glossary

**Module**: anything with an interface and implementation, from a function to a package or a slice across tiers. _Avoid_: unit, component, service.

**Interface**: everything a caller must know: types, invariants, ordering, errors, configuration, and performance characteristics. _Avoid_: API, signature, which are too narrow here.

**Implementation**: the code inside a module. Use **adapter** when discussing its role at a seam; use implementation for its contents.

**Depth**: behavior available per unit of interface a caller or test must learn. A deep module hides substantial behavior; a shallow module's interface is nearly as complex as its implementation.

**Seam** _(Michael Feathers)_: a place where behavior can change without editing that place; where a module's interface lives. Its location is a separate decision from what it hides. _Avoid_: boundary, which is overloaded with DDD's bounded context.

**Adapter**: a concrete implementation satisfying an interface at a seam. This describes its role, regardless of implementation size.

**Leverage**: capability callers gain per unit of interface they learn, reused across call sites and tests.

**Locality**: concentrating changes, defects, knowledge, and verification in one place rather than across callers.

## Deep vs shallow

To deepen an interface, reduce methods, simplify parameters, or hide more complexity inside. A large implementation alone does not establish depth.

## Principles

- Depth concerns the interface. A module may contain small, swappable parts and internal test seams without exposing them to callers.
- Apply the deletion test. If deleting a module removes complexity, it was a pass-through. If complexity spreads across callers, the module was useful.
- Test through the interface callers use. Tests needing access past it may indicate the wrong module shape.
- Introduce a seam only when something varies across it. One adapter is hypothetical; two justified adapters make it real.

## Designing for testability

1. Accept dependencies instead of creating them internally.
2. Return results instead of mutating inputs or producing side effects.
3. Keep the interface small to reduce test cases and setup.

## Relationships

A module has one interface, located at a seam. Adapters satisfy that interface. Depth produces leverage for callers and locality for maintainers.

## Rejected framings

- Implementation-lines divided by interface-lines, Ousterhout's depth ratio, rewards padding. Use depth as leverage instead.
- The TypeScript `interface` keyword or public methods omit other facts callers must know.
- Use seam or interface instead of the overloaded term boundary.

## Going deeper

- [DEEPENING.md](DEEPENING.md): dependency categories, seam discipline, and replacing shallow tests.
- [DESIGN-IT-TWICE.md](DESIGN-IT-TWICE.md): parallel alternative designs compared by depth, locality, and seam placement.
