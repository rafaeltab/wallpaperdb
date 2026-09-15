# Codex conversation

## User

$ask-matt matt pocock's skills have a concept of guidelines/code guidelines. How are these intended to be used? What kind of stuff should go in there?

## Assistant

I’m using `ask-matt` as the router, then I’ll trace “guidelines” into the skills that actually consume them—especially implementation and review—so the answer reflects the intended workflow rather than just the folder name.

## Assistant

The key distinction is already emerging: these guidelines are not another requirements document. They are repository-level “house rules” used by the Standards half of code review, while the issue/spec supplies the feature-specific intent. I’m checking the discovery rules and setup templates now to pin down what belongs where.

## Assistant

One important caveat: in the upstream flow, `/code-review` explicitly discovers these documents, but `/implement` does not explicitly preload an arbitrary guidelines file. So if a rule must shape code before review, it needs to be discoverable through the repository’s agent instructions (or a repo-specific implementation skill), not merely buried in docs.

## Assistant

Think of code guidelines as the repository’s human-enforced engineering policy: stable conventions that an implementation should follow and that a reviewer can verify from a diff.

In Matt’s flow, they matter most during `/code-review`:

- The Standards reviewer discovers files such as `CODING_STANDARDS.md` and `CONTRIBUTING.md`.
- It reports violations separately from whether the change satisfies the spec.
- It ignores rules already enforced mechanically by tooling.
- Repository guidelines override the built-in Fowler code-smell heuristics.
- Documented requirements may be treated as hard violations, so only document rules you genuinely want enforced.

There is no required “guidelines” directory or canonical filename. The setup skill only configures issue tracking, triage, and domain docs. Standards are discovered from whatever authoritative documents the repository provides. For reliable discovery, I’d link the canonical standards document from `AGENTS.md`.

Good content includes:

- Architectural boundaries: “Route handlers must not access the database directly.”
- Established application patterns: error representation, logging, dependency injection, repositories.
- Testing philosophy not expressible through tooling: public seams, when integration tests are required, permitted mocking.
- Dependency rules: which packages may depend on which layers.
- Compatibility and migration expectations.
- Semantic naming rules where they encode project meaning.
- Security, privacy, and observability practices visible in code.
- Explicit exceptions and the scope of each rule.

Avoid putting these there:

| Concern | Better home |
|---|---|
| Formatting, import ordering, basic lint rules | Biome/ESLint/TypeScript configuration |
| Feature-specific behavior | Issue, ticket, or spec |
| Domain terminology | `CONTEXT.md` |
| Why an architectural decision was made | ADR |
| Commands agents must use | `AGENTS.md` or an implementation skill |
| Branch names and commit format | Contributor/workflow guide |
| Aspirational advice nobody consistently follows | Don’t make it an enforceable standard |

A useful rule format is:

```md
### Database access

Scope: HTTP handlers

Rule: Route handlers must call an application module; they must not query
Drizzle directly.

Why: This keeps authorization and transaction behavior behind one interface.

Exception: Readiness checks may execute the documented health query.

Enforcement: Code review.
```

For WallpaperDB specifically, [development-guidelines.mdx](/home/rafaeltab/wallpaperdb/apps/docs/content/docs/development-guidelines.mdx) currently mixes several categories:

- “Use RFC 7807 errors” and “no direct database access in routes” are strong code guidelines.
- “Run `make format`” is workflow/tooling guidance.
- Branch naming and Conventional Commits are contribution workflow.
- “Always write tests first” belongs primarily in the implementation/TDD workflow because a final diff cannot reliably prove the order work happened.
- Rules such as “mock all dependencies” or “unit tests under 1ms” should probably be reconsidered: they are overly absolute and may conflict with testing through meaningful public seams.

Your repository-specific [development-principles skill](/home/rafaeltab/wallpaperdb/.agents/skills/development-principles/SKILL.md) is already acting as the proactive implementation policy. I’d keep that short, link it from `AGENTS.md`, and place the fuller, code-reviewable standards in one clearly authoritative document.

I used [`ask-matt`](/home/rafaeltab/devenv/config/opencode/src/.agents/skills/ask-matt/SKILL.md) to route this question to the [`code-review` definition](/home/rafaeltab/devenv/config/opencode/src/.agents/skills/code-review/SKILL.md), where guidelines receive their concrete meaning in the workflow.

## User

I am not sure if I fully agree with all the development guidelines we already have, and think the guidelines definitely need to be strengthened, and made more concise.

Can you $grill-me about code guidelines, architecture, etc?

For now add them all into one CODING_STANDARDS file.
Don't omit rules that are already present in other locations, we want to make this one file the authoritative document on the matter

## Assistant

I’m using `grill-me` as requested. I’ll first inventory every existing rule so the interview tests the real conflicts and gaps; then we’ll consolidate the decisions into one authoritative `CODING_STANDARDS.md` without silently dropping existing rules. The grill will proceed one decision at a time.

## Assistant

`grill-me` delegates its behavior to the underlying `grilling` skill, so I’m loading that interview contract before asking the first question. No standards file will be rewritten until the choices behind it are settled.

## Assistant

First decision: what exactly should `CODING_STANDARDS.md` govern?

My recommendation is that it become the authoritative source for **all normative engineering rules governing a code change**, including:

- Architecture and module boundaries
- TypeScript and API conventions
- Testing expectations
- Database migrations
- Errors, logging, security, and observability
- Documentation obligations
- Change discipline and verification requirements

It would remain concise by stating the enforceable rule, scope, and exceptions. Longer tutorials, examples, and architectural rationale can stay in guides and ADRs, but those documents must point back to `CODING_STANDARDS.md` rather than introduce additional rules.

That means workflow rules such as “use TDD,” “make incremental changes,” and “run `make ci`” would also live in this file—not just rules visible in the final source code.

Do you agree with that broad scope, or should `CODING_STANDARDS.md` govern only the resulting code and leave development workflow elsewhere?

Per [`grill-me`](/home/rafaeltab/wallpaperdb/.agents/skills/grill-me/SKILL.md), I’m stopping after this one decision and won’t rewrite anything until the interview reaches shared understanding.

## User

correct though this is only temporary we want to add better organization later so that we don't just dump all the standards in one file we want to take this file now just fill it with all the guidelines as we go and then refactor that into something neat after

## Assistant

Understood: `CODING_STANDARDS.md` is the temporary collection point, not the intended long-term information architecture. I’ll continue the `grill-me` interview and treat later splitting/indexing as a separate refactor. Before the next architecture question, I’m using the repository overview and codebase-design vocabulary to ground it in WallpaperDB’s actual structure.

## Assistant

Captured: one temporary authoritative file now; better organization later.

Next decision: how should strengthened standards apply to legacy code that already violates them?

My recommendation is **prospective enforcement**:

- All new code must comply.
- Changed code must not introduce or expand a violation.
- Directly touched code should be brought into compliance when the correction is small and relevant.
- Unrelated legacy violations do not block a change.
- Significant remediation becomes separate tracked work.
- Existing code is not evidence that a pattern is acceptable; the standard wins.

Immediate repository-wide compliance would turn strengthening the standards into a large migration and encourage unrelated cleanup in feature work.

Do you agree with prospective enforcement?

I used the project overview and `codebase-design` guidance to check that this distinction matters here: WallpaperDB currently contains several generations of service, repository, connection, and route patterns, so stronger architecture rules will inevitably conflict with some existing code.

## User

All coding standards will be applied to legacy code that already exists. This work will be done by agents and I will ask them to update the entire codebase following test-driven development to make sure everything is covered and to make sure we don't have any breaking bugs.

## Assistant

Captured: the standards describe the required end state for the whole repository—no grandfathered code—and the later migration will be agent-executed. Because you explicitly require TDD, I’m applying the repository’s `tdd` guidance to pressure-test whether the migration can actually support the “no breaking bugs” goal before we define architecture rules.

## Assistant

Captured: every existing violation is migration scope; there is no permanent legacy exemption.

One important correction: TDD alone cannot guarantee zero regressions, especially when restructuring behavior that already exists. A behavior-preserving refactor often cannot begin with a failing test—the behavior is already working.

My recommendation is to mandate two distinct loops:

- **Behavior-preserving migration:** add or confirm characterization tests through the public interface, establish green, make one structural change, and prove it remains green.
- **Behavior change or bug fix:** use strict red → green, one behavior at a time.
- In both cases, avoid tests coupled to the old internal structure; otherwise they obstruct the architecture migration without protecting real behavior.
- Run broader integration and E2E checks at defined checkpoints because unit tests alone cannot protect service contracts.

Should `CODING_STANDARDS.md` make this distinction, rather than calling every legacy refactor “red → green TDD”?

This question follows the repository’s [`tdd` guidance](/home/rafaeltab/wallpaperdb/.agents/skills/tdd/SKILL.md), particularly its requirement to test observable behavior through public interfaces.

## User

Yes of course TDD alone cannot guarantee zero regressions. We already have very strong tests in place that test basically the entire flow. Don't worry, I'll make sure to pay extra attention to this as well. And worst case, if it breaks, we're not running this in production.

I do want to focus on putting the actual coding standards in place right now, not focusing on how I will upgrade everything to that, just to make sure that we have the actual coding standards.

## Assistant

Understood. I’m dropping migration mechanics from the interview; they won’t drive the standards document. From here on, each question will decide the desired properties of the codebase itself, beginning with its organizing architectural principle.

## Assistant

Understood. We’ll define the target standards only and leave migration strategy out of this interview.

Next architecture decision: should WallpaperDB prescribe fixed horizontal layers—`routes/`, `services/`, `repositories/`, mandatory `*Service` classes—or organize code around cohesive capabilities and deep modules?

My recommendation is **capability-oriented deep modules**:

- Keep deployable applications and shared packages as the major boundaries.
- Within them, group code that changes together around a capability.
- Give each module a small public interface that hides substantial behavior.
- Introduce repositories, adapters, and interfaces only at meaningful seams—not as mandatory layers.
- Keep transport handlers thin, but do not require a pass-through controller/service chain.
- Co-locate private implementation details with their module.
- Reject classes or wrappers that merely delegate.
- Share code because it represents one stable concept used by multiple consumers, not merely because two snippets look similar.

This would supersede current prescriptions such as the standard `routes/` → `services/` structure and universal `Service` suffix. Those patterns could still appear where they genuinely fit, but would no longer be architecture requirements.

Should this be the architectural foundation of the standards?

## User

I want the public interface to be deep modules right so I want a deep module layer and below that it should hide a big implementation but that implementation may still have several actual layers so we're organizing around vertical slices using deep modules but applying architectural layers within that

## Assistant

Yes—with one terminology adjustment: I would not define a horizontal “deep-module layer.” Each vertical capability should itself be a deep module. Otherwise the top layer risks becoming a collection of shallow facades.

A capability would look conceptually like:

```text
Small capability interface
        ↓
Application orchestration
        ↓
Domain policy and state
        ↓
Ports to external systems
        ↓
Infrastructure adapters
```

The implementation may contain several layers and internal seams, but callers see only the capability interface.

My recommended dependency rule is:

- Domain policy remains independent of Fastify, Drizzle, NATS, storage SDKs, and dependency-injection frameworks.
- Application orchestration coordinates domain behavior and declared ports.
- Infrastructure adapters implement those ports.
- Transport code translates HTTP/events into capability calls and translates results back.
- The composition root is the only place that knows and wires the complete implementation.
- Layers are introduced only when the implementation is complex enough to benefit; a simple capability can remain one file.
- Internal layers must not leak through the capability’s public interface.

Should we adopt that dependency direction and keep internal layering proportional, rather than requiring every capability to contain every layer?

## User

Correct and I do like that you're using the term ports because I think I want to try hexagonal architecture for this.

## Assistant

Good—that gives us a sharper architecture model.

Next decision: where should the hexagonal boundary live?

My recommendation is **one hexagon per capability/deep module**, composed inside each deployable application:

- The module’s public interface is its inbound/driving port.
- The module declares the outbound/driven ports it needs.
- Domain and application code live inside the hexagon.
- Fastify routes, NATS consumers, scheduled jobs, and CLI entry points are driving adapters.
- Drizzle repositories, NATS publishers, MinIO clients, clocks, and external APIs are driven adapters.
- Ports belong to the capability that consumes them, not to the adapter or a global `ports/` package.
- The application’s composition root selects and wires adapters.
- Infrastructure adapters may be reused, but domain/application modules must not depend on them.
- A capability that needs no external dependency does not invent outbound ports.

This creates several small, deep hexagons within a service rather than one service-wide hexagon with a large, vague interface.

Should the standard adopt capability-level hexagons, or should each entire microservice be treated as one hexagon containing multiple capabilities?

## User

Correct

## Assistant

Captured: each capability is a deep module and its own hexagon; deployable applications compose those hexagons.

Next decision: what is important enough to become a port?

My recommendation:

- Create outbound ports for genuine side-effect or technology boundaries: databases, object storage, messaging, clocks, randomness, filesystem access, and external APIs.
- Express ports in the capability’s language—not as generic CRUD interfaces or copies of a vendor SDK.
- Let the consuming capability own the port.
- Do not create interfaces for internal collaborators merely to support mocking or dependency injection.
- Do not abstract deterministic in-process code unless multiple real implementations or a meaningful internal seam exist.
- A single production adapter is acceptable at an external boundary because the port protects the application from infrastructure concerns; tests may provide a controlled adapter.
- Keep port methods narrow in number but semantically substantial—for example, `reserveUpload(...)`, not generic `insert(...)`.

Should this be the rule for when ports are introduced?

## User

Correct. I think these outbound ports are indeed related to some kind of side effect or technology boundaries. And they should not be expressed in CRUD language. They should be expressed in the capabilities language. Just to clarify, it should not be in the technologies language. So it shouldn't be database language, object storage language, messaging language. it should be the capabilities language.

And I want you to give some examples to me of what you understand now from what I mean with this language, just so I can verify we're on the same line.

## Assistant

I’m using `domain-modeling` here because the distinction you’re drawing is exactly about who owns the vocabulary: capabilities should name ports in domain terms, while adapters translate those terms into PostgreSQL, NATS, MinIO, or other technology operations. I’ll ground the examples in WallpaperDB’s existing capabilities.

## Assistant

Yes. My understanding is:

> A port describes what the capability needs accomplished. It must not describe which technology will accomplish it or expose that technology’s operating model.

The adapter may have a technology-specific name because that is where translation happens.

| Technology-shaped port | Capability-shaped port | Possible adapter |
|---|---|---|
| `WallpaperRepository.insertRow()` | `UploadLedger.beginUpload()` | `PostgresUploadLedger` |
| `WallpaperRepository.updateStatus()` | `UploadLedger.markOriginalPreserved()` | `PostgresUploadLedger` |
| `S3Client.putObject()` | `OriginalArchive.preserveOriginal()` | `MinioOriginalArchive` |
| `S3Client.deleteObject()` | `OriginalArchive.discardOriginal()` | `MinioOriginalArchive` |
| `NatsPublisher.publish(subject, data)` | `WallpaperAnnouncements.announceUploadAccepted()` | `NatsWallpaperAnnouncements` |
| `RedisClient.incr(key)` | `UploadAllowance.claimAttempt()` | `RedisUploadAllowance` |
| `VariantRepository.query(width, height)` | `VariantCatalog.findBestMatch()` | `PostgresVariantCatalog` |
| `SharpClient.resize(options)` | `WallpaperRenderer.renderVariant()` | `SharpWallpaperRenderer` |
| `ProfileTable.update(...)` | `ProfileDirectory.changeHandle()` | `PostgresProfileDirectory` |
| `EventBus.emit(...)` | `ProfileAnnouncements.announceHandleChanged()` | `NatsProfileAnnouncements` |

For example:

```typescript
// Owned by the wallpaper-upload capability
export interface OriginalArchive {
  preserveOriginal(
    upload: AcceptedUpload,
  ): Promise<PreservedOriginal>;

  discardOriginal(
    original: PreservedOriginal,
  ): Promise<void>;
}
```

```typescript
// Infrastructure translates capability operations into MinIO operations
export class MinioOriginalArchive implements OriginalArchive {
  // putObject, deleteObject, bucket names, keys, retries, and SDK errors
  // are private implementation details.
}
```

The port should therefore avoid leaking:

- SQL concepts such as rows, queries, transactions, and columns
- Object-storage concepts such as buckets, keys, and `putObject`
- Messaging concepts such as subjects, acknowledgements, and headers
- Redis concepts such as keys, TTLs, Lua scripts, and increments
- Vendor request or response types
- Generic infrastructure exceptions

Those concepts belong inside adapters. The capability should exchange its own types—`AcceptedUpload`, `PreservedOriginal`, `VariantRequest`, `Profile`, and so forth—and receive capability-meaningful failures.

This does not mean every generic primitive needs an elaborate domain disguise. `Clock.now()` and `IdGenerator.next()` can remain technology-neutral ports when their meaning is genuinely generic. The prohibition is against making the capability speak the vocabulary of its adapters.

Is that precisely the separation you mean?

I used the [`domain-modeling` discipline](/home/rafaeltab/wallpaperdb/.agents/skills/domain-modeling/SKILL.md) to keep these examples in the consuming capability’s language rather than infrastructure terminology.

## User

This looks interesting, not quite what I am familiar with, but that's fine. Is this a good design supported by common practices, or is this magic that I came up with?

## Assistant

This is not architectural magic, but your formulation combines several established ideas in a slightly stricter way. I’m checking the original Ports-and-Adapters description and primary architecture references so I can separate “canonical hexagonal architecture” from the design choices we are adding on top.

## Activity

    web search: Alistair Cockburn Hexagonal Architecture ports adapters original article port purpose technology agnostic ...

## Assistant

It is a well-supported design, not magic you accidentally invented. More precisely, you have combined several established practices:

- Cockburn’s original Hexagonal Architecture says a port represents a **purposeful conversation**, while technology-specific adapters translate between that conversation and external technology. He explicitly describes the application’s interaction as semantically meaningful and independent of the database/UI/device. That strongly supports capability-language ports. [Alistair Cockburn: Hexagonal Architecture](https://alistair.cockburn.us/hexagonal-architecture)
- Fowler’s discussion of dependency inversion says persistence interfaces should contain operations meaningful to the domain’s goals, not operations meaningful to a database. [Martin Fowler: DIP in the Wild](https://www.martinfowler.com/articles/dipInTheWild.html)
- Fowler also recommends top-level domain-oriented modules that may be internally layered, which closely matches your “vertical capability outside, architectural layers inside” model. [Martin Fowler: Presentation–Domain–Data Layering](https://martinfowler.com/bliki/PresentationDomainDataLayering.html)

What is established:

- Business code owns the ports it needs.
- Ports describe purposes, not mechanisms.
- Adapters translate between domain/application language and technical language.
- Dependencies point toward the application.
- Domain-oriented vertical modules can contain internal layers.

What is our particular design choice:

- Treating every capability as its own small hexagon is stricter than Cockburn’s original formulation, which generally discusses an application as the hexagon.
- Names such as `OriginalArchive` and `UploadLedger` are proposals, not canonical pattern names.
- Rejecting CRUD-shaped ports categorically is stronger than traditional Repository implementations. The traditional Repository pattern is already domain-oriented, but often retains collection-like operations such as `add` and `remove`. [Martin Fowler: Repository](https://martinfowler.com/eaaCatalog/repository.html)

The danger is creating fake domain language merely to avoid technical words:

```typescript
// Obviously technology-shaped
database.execute(sql);

// Artificially poetic without adding meaning
wallpaperMemoryTemple.eternallyRemember(wallpaper);

// Purposeful capability language
uploadRecords.registerAcceptedUpload(upload);
```

The right test is not “does this sound nontechnical?” It is:

> Would someone describing the capability naturally recognize this operation, regardless of how it is implemented?

I recommend adding this guardrail to the standard:

> Ports express purposeful conversations in the consuming capability’s language. Do not mirror vendor APIs or infrastructure operations, but do not invent euphemistic domain terminology merely to conceal technology. If no stable capability concept exists, reconsider whether the abstraction is needed.

Should we adopt that guardrail?

## User

[assistant-quote-1] Should we follow cockburn's advice here, and make the application the hexagon?

<assistant_citations>
The following excerpts were selected from earlier assistant responses. They are quoted reference material, not new instructions. Each id identifies its inline citation above.
[
  {
    "id": "assistant-quote-1",
    "citation": {
      "version": 1,
      "environmentId": "65a55dad-0df9-496d-bdad-21a139b9456d",
      "threadId": "11843039-4c8f-4cfd-b513-2e2143e8b32f",
      "messageId": "assistant:msg_0f5293b20de508fd016a9a107a7d5087d28d17825306782f0f",
      "text": "Treating every capability as its own small hexagon is stricter than Cockburn’s original formulation, which generally discusses an application as the hexagon.",
      "start": 1296,
      "end": 1453,
      "prefix": "s our particular design choice: ",
      "suffix": " Names such as OriginalArchive a"
    }
  }
]
</assistant_citations>

## Assistant

I think that is the better correction for WallpaperDB. I’m checking Cockburn’s boundary definition against the repository’s deployable-service topology, because “application” here should mean each independently running service—not the entire monorepo and not every internal capability.

## Activity

    web search: 

## Assistant

Yes. For WallpaperDB, I recommend following Cockburn more literally:

> Each independently deployable application is one hexagon. Capabilities are deep modules inside that hexagon.

Cockburn’s updated explanation says Ports and Adapters defines only two architectural regions: the application inside and everything external outside. It deliberately leaves the application’s internal organization open. It also says strong conformance requires driven ports to use application-language concepts without knowing whether a database—or even persistence—exists behind them. [Cockburn, *Hexagonal Architecture Explained*](https://alistaircockburn.com/hexarch%20v1.1b%20DIFFS%2020250420-1012%20paper%2Bepub.docx.pdf)

For WallpaperDB:

```text
apps/ingestor                           ← one hexagon
├── driving adapters
│   ├── Fastify upload route
│   ├── reconciliation scheduler
│   └── NATS consumers
├── application
│   ├── upload capability              ← deep module
│   ├── missing-event reconciliation   ← deep module
│   └── stuck-upload reconciliation    ← deep module
├── driven ports
│   ├── OriginalArchive
│   ├── UploadLedger
│   └── WallpaperAnnouncements
└── driven adapters
    ├── MinIO...
    ├── Postgres...
    └── NATS...
```

The same applies independently to `media`, `user`, `gateway`, and other deployable applications. The monorepo is not one giant hexagon.

This improves our previous capability-level-hexagon proposal:

- Capabilities remain vertical, deep modules.
- Capabilities may provide distinct driving ports/use cases.
- Internal application layers remain allowed.
- Capabilities can collaborate directly through application-language interfaces.
- We avoid nested hexagons and adapter ceremony between ordinary internal modules.
- Another service, database, queue, HTTP framework, filesystem, clock, or other external actor sits outside the application.
- Shared packages are not automatically hexagons; they are modules or adapter implementations depending on their purpose.

Fowler’s recommendation fits neatly alongside this: top-level domain-oriented modules may be internally layered. [Fowler, *Presentation–Domain–Data Layering*](https://martinfowler.com/bliki/PresentationDomainDataLayering.html)

So I recommend that we revise our earlier decision to:

> WallpaperDB uses one hexagon per independently deployable application. Each application is organized internally as vertical capability modules with deep interfaces and proportional internal layering.

Should that replace the earlier “one hexagon per capability” decision?

## User

yes

## Assistant

Captured: one hexagon per independently deployable application; deep capability modules inside it.

Next decision: must every port be declared with a TypeScript `interface`?

My recommendation is **no mandatory interface declaration**:

- Every port must have a clear conceptual contract: operations, types, invariants, failure modes, and behavioral guarantees.
- Driven ports require an application-owned TypeScript contract because external adapters must depend inward and satisfy it.
- A driving port may simply be an exported function, class, or object when there is only one application implementation.
- Introduce a separate driving-port `interface` when callers need substitution, the dependency crosses a package boundary, or the explicit contract materially improves clarity.
- Do not create an interface that mechanically duplicates a concrete class merely to satisfy an architectural template.
- TypeScript structural types are acceptable; `implements` is optional unless its explicit verification improves readability.

Cockburn explicitly recognizes both approaches for driving ports—declaring an interface or using the application class directly—as valid choices.

Should the standard require explicit contracts for driven ports while allowing driving ports to use the simplest clear TypeScript representation?

## User

Since we're using dependency injection I think we ought to have at least an injectable declaration. What do you think is the best option here?

## Assistant

The best answer depends on how WallpaperDB currently uses TSyringe, because TypeScript interfaces disappear at runtime. I’m checking the existing registration and injection patterns before recommending whether ports should use symbols, abstract classes, or concrete classes as tokens.

## Assistant

The best option for TypeScript + TSyringe is:

1. A TypeScript interface describing the port.
2. A namespaced symbol providing its runtime DI identity.
3. Both owned and exported by the application.
4. An adapter registered against that symbol in the composition root.

```typescript
// application/upload/original-archive.ts
export interface OriginalArchive {
  preserveOriginal(
    upload: AcceptedUpload,
  ): Promise<PreservedOriginal>;
}

export const ORIGINAL_ARCHIVE = Symbol.for(
  "wallpaperdb.ingestor.original-archive",
);
```

```typescript
// adapters/minio/minio-original-archive.ts
export class MinioOriginalArchive implements OriginalArchive {
  // Translate PreservedOriginal into buckets, keys, and MinIO calls.
}
```

```typescript
// composition-root.ts
container.register<OriginalArchive>(ORIGINAL_ARCHIVE, {
  useClass: MinioOriginalArchive,
});
```

```typescript
// driving adapter
const uploadWallpaper =
  container.resolve<UploadWallpaper>(UPLOAD_WALLPAPER);
```

Why this is preferable:

- Interfaces provide compile-time contracts but disappear at runtime.
- Symbols provide stable runtime DI tokens without collision-prone strings.
- Interfaces plus symbols support classes, objects, factories, and test adapters.
- Abstract classes could combine the type and runtime token, but they unnecessarily constrain every adapter to a class-shaped abstraction.
- Concrete classes should not be used as port tokens because callers then depend on the implementation.
- String tokens such as `"Logger"` and `"TimeService"` are easy to mistype and collide.

WallpaperDB already has the beginnings of this pattern in [ports.ts](/home/rafaeltab/wallpaperdb/apps/color-extractor/src/services/ports.ts). Its interface-and-symbol mechanism is sound, but some contracts still leak infrastructure:

```typescript
interface ImageReader {
  read(bucket: string, key: string): Promise<Buffer>;
}
```

That should eventually become capability-shaped, perhaps:

```typescript
interface WallpaperSource {
  openOriginal(
    wallpaper: WallpaperReference,
  ): Promise<WallpaperContent>;
}
```

There is a second, deeper decision. My recommendation is to keep TSyringe itself outside the application core:

- Application classes accept port contracts through ordinary constructors.
- They do not import `tsyringe` or use `@inject()` decorators.
- The composition root uses TSyringe factories and registrations to construct them.
- Driving adapters resolve inbound ports, not concrete implementations.
- Infrastructure adapters may use TSyringe because they are already outside the hexagon.

That preserves dependency injection while preventing the DI container from becoming an application dependency.

Should we enforce this strict rule—TSyringe only in composition roots and adapters—or permit TSyringe decorators inside application modules for reduced wiring boilerplate?

## User

This does sound good. However, I am wondering if I should be considering a migration to effect ts, I have heard many good things about it, in which case this choice might not be right

## Assistant

That concern is valid: Effect would not merely replace TSyringe’s token syntax. It could become the application’s execution, error, resource, concurrency, and dependency model. I’m checking WallpaperDB’s present dependencies and Effect’s official service/layer model before recommending whether the standards should commit to either approach.

## Activity

    web search: site:effect.website/docs requirements management services Context.Tag Layer Effect official ...

## Activity

    web search: 

## Assistant

Yes, Effect is worth considering for WallpaperDB—but not merely as a nicer DI container.

Effect would potentially replace or reshape several concerns at once:

- TSyringe dependency injection
- Promise-based asynchronous workflows
- Exception-based error handling
- Retry and scheduling logic
- Connection/resource lifecycles
- Concurrency and cancellation
- Logging, tracing, and metrics
- Runtime schema handling

Its central type, `Effect<Success, Error, Requirements>`, makes results, failures, and dependencies explicit. Services use `Context.Tag`; implementations and dependency graphs use `Layer`. [Effect’s official overview](https://www.effect.website/) describes this broader scope and supports incremental interoperation with existing Promise-based code.

WallpaperDB is a plausible candidate because it has numerous long-running consumers, schedulers, retries, connections, failure modes, and OpenTelemetry instrumentation. Conversely, every backend application currently uses TSyringe, so a complete adoption would be a major programming-model migration—not a token substitution.

The hexagonal decisions remain valid either way:

| Architectural concept | TSyringe | Effect |
|---|---|---|
| Port contract and runtime identity | Interface + symbol | `Context.Tag` service |
| Adapter implementation | Class/object | Service implementation |
| Composition | Container registrations | `Layer` composition |
| Required dependencies | Constructor parameters | `Effect` requirements |
| Test adapter | Registered test implementation | Test `Layer` |

Therefore, I would retract the proposed **TSyringe-specific** coding standard for now. The authoritative standards can already say:

- Applications own their ports.
- Ports use application language.
- Adapters depend inward and translate technology concepts.
- Dependencies are explicit.
- Wiring happens at the composition boundary.
- Application behavior can run with controlled adapters in tests.
- Concrete infrastructure dependencies never leak into application modules.

We should not yet prescribe symbols, decorators, `Context.Tag`, or `Layer`.

If the only desired improvement were dependency injection, I would stay with TSyringe. Effect becomes compelling only if you want its typed-error and execution model across the application core as well.

My recommendation is to keep the architecture standards runtime-neutral and mark the concrete TypeScript execution/DI model as unresolved until a small, representative Effect prototype compares the two.

Should we take that approach?

## User

Okay, so I know effect is bigger than just a DI container. I am considering a complete migration over to it. However, let's consider that out of scope for now. But let's organize our coding standards such that we have separation between architectural versus things that would change when we migrate to effect.

## Assistant

Captured. The single temporary `CODING_STANDARDS.md` will visibly separate:

- **Architecture invariants:** hexagonal boundaries, deep capability modules, dependency direction, ports, adapters, and domain language. These should survive an Effect migration.
- **Application programming model:** DI representation, async return types, error channels, resource management, concurrency, and composition mechanics. These may later change from TSyringe/Promises to Effect.
- **Technology-specific adapter standards:** Fastify, Drizzle, NATS, MinIO, OpenTelemetry, and similar integrations.
- **Testing, code quality, and delivery standards:** separated from architecture even while remaining in the same file.

We will not commit to TSyringe-specific interface/token conventions during this interview.

Next architectural decision: where should business rules live inside a capability?

My recommendation is:

- Domain rules should be expressed as deterministic domain types and functions whenever practical.
- Application orchestration should coordinate domain behavior, transactions, and outbound ports.
- Domain code must not perform I/O or know about adapters.
- Value objects should enforce meaningful invariants, not wrap every primitive.
- Aggregates should exist only where a real consistency boundary requires them.
- Simple behavior may remain a straightforward function; every capability does not need entities, repositories, factories, and aggregates.
- Technology failures should be translated before application/domain policy acts on them.

This gives us a domain-centered architecture without imposing ceremonial DDD everywhere.

Should that be the standard?

## User

No let's commit to the tsyringe specific interface/token conventions, because we're just acting as if the effect migration doesn't exist.

## Assistant

Understood. We’ll write the TSyringe conventions as current, enforceable standards—not hedge around a hypothetical Effect migration. The document will still isolate them under an **Application Programming Model: TSyringe** section so a future migration has a clear replacement boundary.

The convention will be:

- Every injected driving or driven port has an explicit TypeScript interface.
- Every port has a colocated, namespaced `Symbol.for(...)` token.
- No string tokens.
- Adapters explicitly implement their port interfaces.
- The composition root registers adapters against port tokens.
- Driving adapters resolve inbound port tokens, never concrete application classes.
- Concrete classes may be injected directly only for private implementation collaborators that are not ports.

The remaining DI decision is whether application modules may import TSyringe.

My recommendation remains **no**:

- Application constructors accept ordinary typed dependencies.
- Application code contains no `@injectable()`, `@singleton()`, or `@inject()` decorators.
- Composition roots use factories to construct application modules.
- TSyringe decorators may be used in adapters where useful.
- This keeps the hexagon independent of its wiring mechanism while still standardizing on TSyringe.

Should we enforce that separation?

## User

Can you give an example of how that would work?

## Assistant

Here is a concrete example where the upload capability uses TSyringe, but its application code does not depend on TSyringe.

```text
src/upload/
├── domain/
│   └── upload.ts
├── application/
│   ├── upload-wallpaper.ts       # Driving port + implementation
│   ├── original-archive.ts       # Driven port
│   └── upload-ledger.ts          # Driven port
├── adapters/
│   ├── driving/http-upload.ts
│   └── driven/
│       ├── minio-original-archive.ts
│       └── postgres-upload-ledger.ts
└── composition-root.ts
```

### Application-owned driven port

```typescript
// application/original-archive.ts

export interface OriginalArchive {
  preserveOriginal(
    upload: AcceptedUpload,
  ): Promise<PreservedOriginal>;
}

export const ORIGINAL_ARCHIVE = Symbol.for(
  "wallpaperdb.ingestor.original-archive",
);
```

This file contains no MinIO types and imports nothing from TSyringe.

### Application-owned driving port

```typescript
// application/upload-wallpaper.ts

export interface UploadWallpaper {
  execute(command: UploadWallpaperCommand): Promise<UploadReceipt>;
}

export const UPLOAD_WALLPAPER = Symbol.for(
  "wallpaperdb.ingestor.upload-wallpaper",
);

export class UploadWallpaperHandler implements UploadWallpaper {
  constructor(
    private readonly archive: OriginalArchive,
    private readonly ledger: UploadLedger,
  ) {}

  async execute(
    command: UploadWallpaperCommand,
  ): Promise<UploadReceipt> {
    const upload = acceptUpload(command);

    await this.ledger.registerAcceptedUpload(upload);

    const original = await this.archive.preserveOriginal(upload);

    await this.ledger.markOriginalPreserved(
      upload.id,
      original,
    );

    return createUploadReceipt(upload, original);
  }
}
```

The handler receives ordinary TypeScript dependencies. It has no decorators and does not know a container exists.

### Technology-specific driven adapter

```typescript
// adapters/driven/minio-original-archive.ts

import { injectable } from "tsyringe";

@injectable()
export class MinioOriginalArchive implements OriginalArchive {
  constructor(
    private readonly minio: MinioConnection,
  ) {}

  async preserveOriginal(
    upload: AcceptedUpload,
  ): Promise<PreservedOriginal> {
    const bucket = "wallpapers";
    const key = `${upload.id}/original.${upload.extension}`;

    await this.minio.putObject(bucket, key, upload.content);

    return {
      wallpaperId: upload.id,
      reference: key,
    };
  }
}
```

Buckets, keys, SDK methods, and MinIO failures stay in the adapter.

### Composition root

```typescript
// composition-root.ts

container.register<OriginalArchive>(ORIGINAL_ARCHIVE, {
  useFactory: (container) =>
    new MinioOriginalArchive(
      container.resolve(MinioConnection),
    ),
});

container.register<UploadLedger>(UPLOAD_LEDGER, {
  useFactory: (container) =>
    new PostgresUploadLedger(
      container.resolve(DatabaseConnection),
    ),
});

container.register<UploadWallpaper>(UPLOAD_WALLPAPER, {
  useFactory: (container) =>
    new UploadWallpaperHandler(
      container.resolve<OriginalArchive>(ORIGINAL_ARCHIVE),
      container.resolve<UploadLedger>(UPLOAD_LEDGER),
    ),
});
```

This is the only place that knows which concrete adapters implement the upload capability.

### Driving HTTP adapter

```typescript
// adapters/driving/http-upload.ts

export async function registerUploadRoute(
  fastify: FastifyInstance,
): Promise<void> {
  const uploadWallpaper =
    fastify.container.resolve<UploadWallpaper>(
      UPLOAD_WALLPAPER,
    );

  fastify.post("/uploads", async (request, reply) => {
    const command = toUploadCommand(request);

    const receipt = await uploadWallpaper.execute(command);

    return reply.code(201).send(toHttpResponse(receipt));
  });
}
```

The HTTP adapter knows Fastify and the driving port, but not `UploadWallpaperHandler`.

### Application test without TSyringe

```typescript
test("an accepted upload is preserved", async () => {
  const archive = new FakeOriginalArchive();
  const ledger = new InMemoryUploadLedger();

  const uploadWallpaper = new UploadWallpaperHandler(
    archive,
    ledger,
  );

  const receipt = await uploadWallpaper.execute(validUploadCommand);

  expect(receipt.wallpaperId).toBeDefined();
  expect(await ledger.findAcceptedUpload(receipt.wallpaperId))
    .toBeDefined();
});
```

The resulting dependency structure is:

```text
HTTP adapter ──→ driving port ←── application implementation
                                      │
                                      ↓
                                 driven ports
                                      ↑
                                      │
                         MinIO/Postgres adapters

Composition root knows and connects everything.
```

TSyringe performs runtime composition, but the capability remains plain TypeScript. Replacing TSyringe would require rewriting the composition root and possibly adapter annotations—not the domain or application behavior.

Does this level of separation feel worthwhile, or does the factory wiring look too ceremonious for WallpaperDB?

## User

What is the benefit of doing it this way?
What are the deficits of doing it this way?

## Assistant

The strict approach—plain application constructors, with TSyringe confined to adapters and composition roots—buys architectural isolation, but it also sacrifices much of TSyringe’s convenience.

| Benefit | Why it matters |
|---|---|
| Framework-independent application | Domain and application code can run without TSyringe, decorators, or reflection metadata. |
| Honest hexagonal boundary | Infrastructure and composition depend on the application; the application does not depend back on them. |
| Simple isolated tests | Tests instantiate handlers directly without resetting or configuring a global container. |
| Visible object graph | The composition root shows exactly which adapter satisfies each port and which lifetime it receives. |
| Easier framework replacement | Replacing TSyringe affects composition and adapters rather than every application class. |
| No service-locator behavior | Application code cannot secretly resolve undeclared dependencies at runtime. |
| Fewer global-container problems | Tests and multiple application instances are less likely to leak registrations into one another. |

The deficits are significant:

| Deficit | Consequence |
|---|---|
| Verbose factories | Every application constructor must be repeated in registration code. |
| Composition-root churn | Adding a constructor dependency requires editing both the class and its factory. |
| Reduced TSyringe value | Automatic constructor wiring is one of the principal reasons to use TSyringe. |
| Large wiring modules | Applications with many capabilities can accumulate substantial registration code. |
| Runtime token/type separation | TypeScript cannot intrinsically prove that a symbol token always corresponds to one particular interface. |
| More migration work now | Almost every currently decorated application class would need restructuring. |
| Potential architectural theater | We may spend considerable code avoiding a lightweight decorator without gaining meaningful behavioral isolation. |

There are really three positions:

### Strict isolation

```typescript
export class UploadWallpaperHandler {
  constructor(
    private readonly archive: OriginalArchive,
  ) {}
}

container.register(UPLOAD_WALLPAPER, {
  useFactory: (container) =>
    new UploadWallpaperHandler(
      container.resolve(ORIGINAL_ARCHIVE),
    ),
});
```

Maximum independence, maximum wiring.

### Pragmatic constructor injection

```typescript
@injectable()
export class UploadWallpaperHandler implements UploadWallpaper {
  constructor(
    @inject(ORIGINAL_ARCHIVE)
    private readonly archive: OriginalArchive,
  ) {}
}

container.register(UPLOAD_WALLPAPER, {
  useClass: UploadWallpaperHandler,
});
```

The application imports TSyringe annotations, but:

- Dependencies remain explicit constructor parameters.
- Ports remain application-owned interfaces.
- Infrastructure types still cannot enter the application.
- The application never accesses the container.
- Tests can still instantiate the class directly.
- Composition remains outside.

### Service locator

```typescript
export class UploadWallpaperHandler {
  async execute(command: UploadCommand) {
    const archive = container.resolve(ORIGINAL_ARCHIVE);
  }
}
```

This should be prohibited. Dependencies become hidden, tests require global setup, and application behavior becomes coupled to container state.

My revised recommendation is the **pragmatic middle**:

- Domain code must remain entirely free of TSyringe.
- Application implementations may use `@injectable()` and constructor-level `@inject(PORT_TOKEN)`.
- Application code must never import or access the container.
- Ports remain explicit application-owned interfaces with symbol tokens.
- Registration, lifetimes, and implementation selection remain in composition roots.
- Driving adapters resolve inbound ports rather than concrete handlers.

This preserves the important hexagonal boundary while avoiding factory boilerplate. The TSyringe dependency is then isolated as an explicit application-programming-model standard, exactly where you wanted Effect-sensitive rules separated.

Should we adopt this pragmatic middle rather than strict TSyringe isolation?

## User

I don't really care which one we pick.

Some of the benefits I agree with and are very light, but others I just don't see.

 'Honest hexagonal boundary' is pretty much just not even a thing, we're not adding any dependencies to things we shouldn't be having dependencies to from what I can see in my brain.

You make a choice, I don't care, as long as we stay consistent I'm good with whatever

## Assistant

Agreed. I overstated “honest hexagonal boundary.” Importing TSyringe annotations is framework coupling, but it does not create an improper dependency on a database, transport, or adapter.

I’m choosing the pragmatic convention:

- Domain code contains no TSyringe.
- Application implementations may use `@injectable()` and constructor `@inject(PORT_TOKEN)`.
- Every injected port has an application-owned interface and namespaced symbol token.
- Application code never accesses the container directly.
- Composition roots select implementations and lifetimes.
- Driving adapters resolve inbound ports, not concrete handlers.
- String tokens and property injection are prohibited.
- Constructor injection is the only permitted injection style.

This is consistent, explicit, testable, and avoids duplicative factory wiring.

Returning to the unresolved architecture question: where should business rules live?

My recommendation is:

- Deterministic business rules live in domain types and functions.
- Application modules orchestrate domain behavior and outbound ports.
- Domain code performs no I/O and knows nothing about adapters.
- Value objects exist only for meaningful invariants.
- Aggregates exist only for real consistency boundaries.
- Simple behavior remains simple; DDD patterns are not mandatory ceremony.
- Adapters translate technical failures into application-meaningful failures.

Should we adopt that standard?

## User

I want to do DDD, it aligns well with matt's skills with the context.md files, it ensures we're actually using good language, so I think it's worth it.

## Assistant

I’m applying the `domain-modeling` skill because you’ve now made DDD and `CONTEXT.md` part of the standards. I’ll distinguish the universally useful DDD discipline—bounded contexts and ubiquitous language—from tactical patterns that can become ceremony if mandated indiscriminately.

## Assistant

Agreed. We’ll make DDD a foundational architecture standard, and `CONTEXT.md` files will be authoritative for the language used in code, tests, ports, events, and documentation.

One distinction matters: DDD does not require every capability to contain an aggregate, entity, value object, repository, factory, and domain service. That would turn the pattern vocabulary into ceremony.

My recommendation is:

- **Strategic DDD is mandatory:** bounded contexts, explicit ownership, ubiquitous language, context mapping, and translation between contexts.
- Every domain term used in a public module interface must agree with the relevant `CONTEXT.md`.
- New or disputed domain language must be resolved in `CONTEXT.md`, including discouraged synonyms.
- **Tactical DDD is evidence-driven:** entities, value objects, aggregates, repositories, domain services, and domain events are introduced when the domain model actually exhibits the corresponding need.
- Aggregates protect real consistency boundaries.
- Value objects protect meaningful invariants.
- Repositories expose collections of aggregates in domain language.
- Domain services hold domain behavior that genuinely belongs to no entity or value object.
- Application orchestration is not mislabeled as a domain service.
- Data-transfer shapes, database records, and integration-event payloads are not automatically domain objects.

This is still “doing DDD”; it applies the modeling discipline universally without mandating every tactical pattern everywhere.

Should we adopt mandatory strategic DDD with proportional tactical DDD?

One existing inconsistency surfaced through the [`domain-modeling` guidance](/home/rafaeltab/wallpaperdb/.agents/skills/domain-modeling/SKILL.md): `CONTEXT-MAP.md` calls the current context “User,” while [apps/user/CONTEXT.md](/home/rafaeltab/wallpaperdb/apps/user/CONTEXT.md) is titled “WallpaperDB.” We’ll need to resolve that when we define bounded-context ownership.

## User

Correct, DDD is about the language not about the exact patterns you're using. 

Per capability, we should decide if we're going to follow DDD language and design patterns, or just DDD language.

Within a capability we have to stay consistent.

## Assistant

Exactly. I’ll record the rule this way:

- Every capability must use the ubiquitous language of its bounded context.
- Each capability chooses one modeling approach:
  - **Language-only DDD:** domain vocabulary with straightforward types and functions.
  - **Tactical DDD:** entities, value objects, aggregates, repositories, domain services, and domain events where appropriate.
- The choice applies consistently across the capability.
- A capability must not casually mix aggregate-oriented modeling with an anemic CRUD model for the same concepts.
- Moving between approaches is an explicit capability-wide design change.
- `CONTEXT.md` records language only; it must not record which implementation patterns were selected.

Next decision: bounded contexts should not automatically equal capabilities or deployable applications.

My recommendation is:

- A bounded context owns a language and model.
- A bounded context may contain several capabilities.
- Every capability belongs to exactly one bounded context.
- A deployable application should normally implement capabilities from one bounded context.
- Integration-oriented applications such as a gateway may interact with several contexts, but must translate between their models rather than inventing one blended model.
- Cross-context events and APIs are contracts between contexts, not shared internal domain objects.
- Each `CONTEXT.md` belongs to a bounded context, not automatically to each application or capability.

Should we adopt that relationship between bounded contexts, capabilities, and applications?

## User

Correct

## Assistant

Captured.

Next decision: how should bounded contexts share code and data models?

My recommendation is:

- Domain entities, aggregates, value objects, and internal domain events must not be shared across bounded contexts by default.
- Similar-looking concepts may be modeled separately when their meanings or invariants differ.
- Cross-context APIs and integration events use explicit contract types.
- The receiving context translates those contracts into its own model at an anti-corruption boundary.
- Integration contracts are not treated as internal domain objects.
- Shared packages are appropriate for:
  - Technology adapters and infrastructure primitives
  - Cross-context contract schemas
  - Truly context-neutral types
  - Testing and development tooling
- A shared domain kernel is allowed only as an explicit, documented exception with clear joint ownership.
- Database schemas and ORM models remain private to their owning context.
- Other contexts reference owned concepts by stable identifiers rather than importing their persistence models.

For example, `@wallpaperdb/events` may publish the schema for `ProfileHandleChanged`, but Gateway should translate that payload into its own search projection rather than importing and manipulating User’s `Profile` aggregate.

Should shared domain models be prohibited by default, with explicit shared kernels as the exception?

## User

correct. One clarification question, does the anti-corruption boundary happen behind the driving port, and in front of it?

## Assistant

For an incoming interaction, the anti-corruption layer is **in front of the driving port**:

```text
Foreign bounded context
        ↓ foreign integration contract
Driving adapter + anti-corruption translation
        ↓ local command/value objects
Driving port
        ↓
Application
```

The driving port must already speak the receiving application’s language. If foreign DTOs cross that port, the external context has contaminated the application model.

For an outgoing interaction, translation happens **behind the driven port**:

```text
Application
        ↓ local capability language
Driven port
        ↓
Driven adapter + anti-corruption translation
        ↓ foreign API/event/storage model
External context or technology
```

For example:

```text
ProfileHandleChanged integration event
        ↓
NATS consumer validates and translates it
        ↓
UpdateProfileSearchEntry command
        ↓
Gateway driving port
        ↓
Gateway application
        ↓
SearchCatalog driven port
        ↓
OpenSearch adapter translates it into an index operation
```

The anti-corruption layer may be a substantial translator module rather than a few mapping lines, but architecturally it belongs with the adapter:

- Before a driving port for incoming interactions
- After a driven port for outgoing interactions
- Never inside domain objects
- Never by allowing foreign contract types to become local domain types

So the port is the boundary: external language stays on the adapter side; local language stays on the application side.

Does that match how you were picturing it?

## User

or*

## Assistant

Yes—**or**, depending on direction:

- For a **driving port**, the anti-corruption translation is in front of the port.
- For a **driven port**, it is behind the port.

Next decision: current guidance says “prefer events over synchronous calls.” I think that is too blunt.

My recommendation:

- Publish events for facts that have already been accepted by the owning context.
- Use asynchronous integration when consumers may react independently and eventual consistency is acceptable.
- Use synchronous calls when the application genuinely requires an answer before it can proceed.
- Never use events to disguise a synchronous request/response workflow.
- Producers must not know their event consumers.
- Integration events must be distinct from internal domain events.
- Consumers must be idempotent and tolerate duplication, delay, and reordering.
- A business invariant should be enforced within one owning context rather than through distributed coordination where possible.

Should this replace the blanket “event-first” rule?

## User

Use a subagent to research event-driven-architecture best practices in this sense, how that combines with hexagonal architecture, and other facets of what we're talking about now

## Assistant

I’m using the `research` skill and delegating this as requested. The subagent will investigate primary sources on event-driven boundaries, domain versus integration events, delivery semantics, idempotency, ordering, anti-corruption translation, and how these fit one-hexagon-per-application architecture; it will leave a cited Markdown report in the repository for our standards interview.

## Activity

    Started `/root/research_event_hex`

## Assistant

The research agent is running independently. While it works, I’m continuing the non-mutating inventory of existing architecture, testing, database, service, and frontend rules so the eventual authoritative file does not lose standards currently scattered across skills and documentation. I’ll return to the event-driven decision after the report arrives.

## Assistant

The research is still in progress. The standards inventory confirms that several existing rules will need judgment rather than blind copying—for example, the current docs simultaneously require TDD, mock-all-dependencies unit tests, real-infrastructure integration tests, and implementation-coupled assertions. I’m cataloguing these as conflicts to resolve during the grill, while preserving every existing rule until we explicitly replace it.

## Assistant

The background agent is still tracing recommendations back to primary sources. I’ve completed the first-pass inventory: existing standards are spread across the development guide, architecture pages, database and testing skills, service scaffolding, observability guidance, and the Sandcastle rules. Several directly conflict—for example, “always use Make” versus a database skill that mandates direct `pnpm` commands—so our final consolidation will need explicit resolutions rather than concatenation.

## Activity

    Interacted with `/root/research_event_hex`

## Assistant

The agent is taking longer than expected, so I’ve asked it to prioritize a completed, decision-oriented report over exhaustive length. One important local finding for the eventual comparison: WallpaperDB already has a transactional-outbox decision for Profile projections, while the shared NATS consumer currently acknowledges success, terminates schema failures, and negatively acknowledges processing failures. The research will tell us which of those should become general standards versus NATS-specific policy.

## Activity

    Interacted with `/root/research_event_hex`

## Activity

    Completed `/root/research_event_hex`

## Assistant

The delegated research is complete: [event-driven-hexagonal-architecture.md](/home/rafaeltab/wallpaperdb/docs/research/event-driven-hexagonal-architecture.md).

Its central conclusion is strong:

> Event-driven architecture should be a communication option at an application’s hexagonal boundary—not the organizing principle inside every application.

That means:

- NATS consumers are driving adapters.
- NATS publishers are driven adapters.
- Broker concepts never cross application ports.
- Domain events remain internal model facts.
- Integration events are public contracts describing committed facts.
- Asynchronous commands describe requested future work and must not masquerade as past-tense events.
- Synchronous communication is appropriate when the caller needs an answer to proceed.
- Required multi-step distributed workflows may need explicit orchestration rather than hidden event choreography.

This matches Cockburn’s application-versus-external-actors boundary and Fowler’s warning about “event notification” secretly being used as a command. [Cockburn](https://alistair.cockburn.us/hexagonal-architecture), [Fowler](https://martinfowler.com/articles/201701-event-driven.html)

The report also recommends standards for:

- Transactional outboxes for state-change publication
- Transactional inboxes or equivalent idempotency
- Stable event IDs across retries
- Explicit ordering requirements rather than assumed global ordering
- Schema compatibility and versioned breaking changes
- Correlation and causation IDs
- Durable quarantine for permanent failures
- Finite retries with backoff
- PII minimization and retention policy
- Contract, replay, duplicate-delivery, reordering, and crash-window tests

JetStream provides at-least-once behavior through explicit acknowledgements and redelivery, but application-level idempotency is still required. [NATS delivery and acknowledgements](https://docs.nats.io/learn/jetstream/delivery-and-acknowledgment)

The local audit also identified concrete WallpaperDB risks: changing event IDs during republication, incomplete inbox guarantees, immediate negative acknowledgements, silent terminal failures, lost out-of-order reactions, storage bucket/key leakage, and inconsistent stream-retention documentation. These are findings for later migration, not standards decisions by themselves.

Returning to the grill, I recommend replacing “prefer events” with this interaction taxonomy:

1. **Integration event:** an owner announces a committed fact; consumers are independent.
2. **Asynchronous command/job:** one known owner is requested to perform work later.
3. **Synchronous call:** the caller needs an answer before deciding how to proceed.
4. **Saga/process manager:** a required distributed workflow has steps, state, deadlines, or compensation.

Should this taxonomy replace WallpaperDB’s blanket event-first rule?

The `research` skill directly shaped this work by requiring the background agent to produce a durable, primary-source-cited report rather than only a conversational summary.

## User

I have noticed people leaning heavily on synchronous calls in the past. Instead of using events to ingest data into the current domain, they would use synchronous calls to retrieve the data from another microservice. This is an antipattern, because it leads to strong coupling between these two services. This is why I went for the strong event-first rule.

If you think you can prevent this from occurring again, I am open to not having such a strong event-first rule.

[assistant-quote-1]  This looks great to me, but humans would abuse the way this is written to justify what I wrote above.

<assistant_citations>
The following excerpts were selected from earlier assistant responses. They are quoted reference material, not new instructions. Each id identifies its inline citation above.
[
  {
    "id": "assistant-quote-1",
    "citation": {
      "version": 1,
      "environmentId": "65a55dad-0df9-496d-bdad-21a139b9456d",
      "threadId": "11843039-4c8f-4cfd-b513-2e2143e8b32f",
      "messageId": "assistant:msg_0f5293b20de508fd016a9a1b677d4487d2b815910821cba6e5",
      "text": "Integration event: an owner announces a committed fact; consumers are independent.\n\n\nAsynchronous command/job: one known owner is requested to perform work later.\n\n\nSynchronous call: the caller needs an answer before deciding how to proceed.\n\n\nSaga/process manager: a required distributed workflow has steps, state, deadlines, or compensation.",
      "start": 2127,
      "end": 2464,
      "prefix": "with this interaction taxonomy: ",
      "suffix": " Should this taxonomy replace Wa"
    }
  }
]
</assistant_citations>

## Assistant

You’re right. The taxonomy alone is too permissive; “the caller needs an answer” can justify almost any synchronous dependency.

I would preserve the intent of event-first but name the stronger principle **application autonomy**:

> An application must maintain locally the foreign-context data required for its routine decisions and queries. It must not synchronously retrieve that data from another WallpaperDB application during request, command, event, or background-job processing.

The enforceable rules would be:

- Foreign state needed repeatedly is ingested through integration events into a local projection.
- Integration events carry enough stable state for consumers to remain autonomous.
- Consumers must not receive an ID-only event and then synchronously call the producer for the actual data.
- Local projections use the consuming context’s model, not replicas of the producer’s ORM entities.
- Temporary unavailability of another WallpaperDB application must not disable unrelated local capabilities.
- A synchronous call must not be introduced merely because creating an event, projection, or consumer requires more work.
- If synchronous access appears necessary for a domain invariant, first reconsider context ownership and application boundaries.

Synchronous cross-application calls would be allowed only for narrow cases:

- Executing an operation inherently owned elsewhere whose immediate outcome is required—not importing its data model.
- Edge composition where the caller is explicitly an API gateway rather than a domain application.
- Data that cannot safely or legally be replicated.
- A documented exceptional freshness requirement that events cannot satisfy.

Every exception would require an ADR explaining:

- Why a local event-fed projection is unsuitable
- Why the coupling is acceptable
- Timeout and failure semantics
- What happens when the other application is unavailable
- Whether the boundary should instead be redrawn

For example:

```text
Prohibited:
Media receives WallpaperUploaded(id)
  → calls Ingestor GET /wallpapers/:id
  → cannot process while Ingestor is unavailable

Required:
Ingestor publishes WallpaperOriginalStored
  → Media translates it into its local model
  → stores a local projection
  → processes independently
```

This is the event-carried-state-transfer distinction from the research: an ID-only notification often hides callback coupling, while carrying the necessary public state supports consumer autonomy. [Fowler, “What do you mean by Event-Driven?”](https://martinfowler.com/articles/201701-event-driven.html)

So I recommend keeping a strong rule, but replacing vague “event-first” language with:

> **Autonomy first:** cross-context data required by an application must normally arrive asynchronously and be maintained locally. Synchronous cross-application data retrieval is prohibited unless approved as a documented architectural exception.

Should we adopt that stronger, harder-to-abuse formulation?

## User

'foreign-context data'  is not quite how I would word it. 

The nuance here for me is:
Data whose source of truth lies within another bounded context, but is needed within the current bounded context. 

The concept of a user might have its source of truth inside a 'user' service, but it may also be needed within a 'billing' service. That doesn't mean 'user' is a foreign context item to the billing service, no it is part of the billing bounded context, it is just sourced from a context that owns its source of truth.

Though I think what followed from it in your message does look accurate

## Assistant

You’re right. I conflated where facts originate with what belongs in the consuming context’s model.

The better distinction is:

- One bounded context is authoritative for particular facts and accepts changes to them.
- Another bounded context may need those facts, but interprets and models them in its own language.
- After translation, the local representation belongs fully to the consuming context. It is not a foreign object living inside it.
- Authority belongs to facts and invariants, not necessarily an entire real-world entity.

For example:

```text
User context is authoritative for:
- identity
- verified email address
- profile lifecycle

Billing context is authoritative for:
- billing status
- payment standing
- subscription entitlement
```

Billing may maintain a local `Customer`, `Subscriber`, or even `User` model containing an identifier and billing-relevant identity attributes. That model belongs to Billing, even though some of its facts originate from User.

I would rewrite the standard as:

> When a bounded context needs data whose source of truth lies in another bounded context, it must normally ingest the relevant facts through integration events and maintain a local representation in its own model. It must not synchronously retrieve those facts during routine processing.

Supporting rules:

- The authoritative context owns changes to the sourced facts.
- The consuming context owns its local representation and its interpretation.
- Integration adapters translate between the two models.
- The local model may rename, reduce, combine, or derive data according to local needs.
- Producer domain objects and persistence records must not be replicated directly.
- Stable identifiers correlate representations across contexts.
- Commands that change authoritative facts are directed to the authoritative context.
- Eventual consistency, replay, and reconciliation must be designed explicitly.
- Synchronous retrieval remains an exceptional architectural decision, not a normal hydration mechanism.

Should this be the canonical formulation?

## User

Correct

## Assistant

Captured.

Next decision: how much data should integration events carry?

My recommendation is a **consumer-autonomy rule**, not “tiny events” or “full entity snapshots”:

- An integration event carries enough authoritative facts for its intended meaning to be processed without an immediate callback to the producer.
- It exposes only stable, intentionally public facts owned by the publishing context.
- It never serializes an ORM record, aggregate, or internal domain event directly.
- It omits fields added merely because one consumer happens to want them.
- Different purposes may require different integration events rather than one universal payload.
- For locally maintained projections, including a current public snapshot can be appropriate because it supports idempotent upserts and replay.
- Sensitive data requires an explicit consumer need and retention policy.
- Large binary content is represented by a capability-level reference, not embedded or exposed through bucket/key details.
- If the required payload becomes enormous or unstable, reconsider the context boundary or interaction rather than falling back automatically to synchronous hydration.

For example, `ProfilePublicDetailsChanged` might carry the current public profile fields needed by search projections, while `ProfileEmailVerified` exposes only that distinct fact to contexts authorized to receive it.

Should integration events be required to carry sufficient purpose-specific state for consumer autonomy, while avoiding universal entity snapshots?

## User

Correct

## Assistant

Captured.

Next decision: publication consistency.

My recommendation is to require a transactional outbox whenever an application both changes transactional state and must publish an integration event representing that change:

- The state change and outbox record are committed in the same database transaction.
- The outbox stores the final integration contract, including its stable event ID and occurrence time.
- A relay publishes the stored event and records successful publication.
- Retries reuse the original event ID; they do not create a new event occurrence.
- Broker acknowledgement must be checked before publication is marked complete.
- Direct database-write-then-publish is not an acceptable correctness mechanism.
- Publishing first and committing state afterward is also prohibited.
- Consumers must still be idempotent because an outbox relay may publish more than once.
- Operations spanning nontransactional resources—such as PostgreSQL plus object storage—require explicit durable workflow state and reconciliation; an outbox alone does not make them atomic.
- Applications without a transactional state store must document an equivalent durability strategy.

WallpaperDB’s User/Profile decision already specifies a transactional outbox, so this would make that reliability rule universal rather than context-specific.

Should the transactional-outbox requirement become a coding standard?

## User

If you rely on an operation being idempotent, you can execute that operation 100 times, and it wouldn't matter. This would also mean that outboxes wouldn't be needed anymore, as you can just retry the operation, as long as the driving adapter has automatic retries.

However:
1. That is only the case for events, and coupling whether we use outbox or not to the driving adapter is wrong.
2. We might end up publishing the same event with different IDs if we do it this way.
3. We're now relying on the operations being idempotent, which may also not be the case.

So I think indeed that I concur.

## Assistant

Exactly. Idempotency and an outbox solve different failure modes:

- **Idempotency** protects against executing the same effect more than once.
- **An outbox** protects against never publishing the event after the originating state commits.

A retrying driving adapter cannot close the loss window if the process commits state and then crashes before publishing or returning. It also risks turning one occurrence into several events with different IDs. The outbox preserves the identity of the original committed fact independently of whichever adapter triggered the use case.

So the transactional-outbox requirement is accepted.

The corresponding consumer-side decision is next. My recommendation is:

- Every integration-event consumer is assumed to receive duplicates.
- By default, it records `(logical consumer, event ID)` in an inbox.
- The inbox record and local state change commit in the same transaction.
- The message is acknowledged only after that transaction commits.
- Broker deduplication is supplementary and never the sole guarantee.
- A naturally idempotent operation may replace an inbox only when repetition is demonstrably equivalent—including emitted events and other side effects.
- Nontransactional effects require a stable operation key plus durable workflow state or reconciliation.
- Deliberate projection rebuilds use a new/reset consumer state rather than bypassing duplicate protection accidentally.

Should durable consumer idempotency, with the inbox as the default mechanism, become a standard?

## User

Wait what is an inbox?

## Assistant

An inbox is a durable record of which integration events a particular consumer has already processed. It is often just a database table:

```text
processed_integration_events
├── consumer_name
├── event_id
└── processed_at

UNIQUE (consumer_name, event_id)
```

When an event arrives, the consumer performs this transaction:

```text
BEGIN

1. Insert (consumer name, event ID) into the inbox.
2. If it already exists, do nothing—the event was processed before.
3. Apply the event’s changes to the local model.
4. Add any resulting outgoing events to the local outbox.

COMMIT

5. Acknowledge the broker message.
```

It protects the critical crash window:

```text
Receive event
    ↓
Update database successfully
    ↓
Process crashes before NATS receives the acknowledgement
    ↓
NATS delivers the event again
```

Without an inbox, the local effect might happen twice. With an inbox, the redelivery finds the event ID already recorded and becomes a no-op.

The inbox record and business update must use the same transaction:

- Crash before commit: neither is saved, so redelivery safely retries.
- Crash after commit but before acknowledgement: both are saved, so redelivery is recognized as a duplicate.
- Successful acknowledgement: normal completion.

“Inbox” can sound as though it stores pending messages. In this usage, it is primarily a **processed-event ledger**. Calling the table `processed_integration_events` may communicate the purpose better.

It does not solve nontransactional side effects such as sending email or invoking an external API. Those require provider idempotency keys, durable workflow state, or another outbox-driven step.

With that meaning, should a transactional processed-event ledger be the default for integration-event consumers?

## User

Hmmmmm I am worried.

relational databases are not the only databases we will interact with. Minio, redis, and opensearch are also services we use.

I fear that with inbox + outbox + actual change in one transaction, we're ignoring the fact that minio, redis, and opensearch are independent transactions.

## Assistant

Your concern is correct. My previous “inbox plus actual change in one transaction” rule only works when both records live under the same transaction manager. It cannot atomically include PostgreSQL, MinIO, Redis, OpenSearch, and NATS.

We should not pretend distributed transactions exist. Instead, require **replay-safe, convergent processing**.

A consumer must use whichever strategy matches its target:

- **PostgreSQL state:** processed-event record and business change in one transaction.
- **OpenSearch projection:** deterministic document identity plus source/entity versioning, so duplicate and stale events converge on the same result.
- **MinIO object:** deterministic object identity, content checksums or conditional operations, and durable workflow state capable of verifying ambiguous outcomes.
- **Redis cache:** treat it as reconstructible; invalidate or refresh after durable state commits. Cache failure must not corrupt authoritative state.
- **External API:** stable provider idempotency key when supported; otherwise durable workflow state and reconciliation or compensation.
- **Multiple resources:** explicit state machine/process manager where each step is independently retryable, observable, and recorded.

For example:

```text
Receive integration event
    ↓
Persist workflow: original-preservation pending
    ↓
Acknowledge event—the application has durably accepted responsibility
    ↓
Write deterministic MinIO object
    ↓
Crash before recording success
    ↓
Worker retries, verifies/replaces the same object
    ↓
Record workflow completed
    ↓
Write resulting integration event to outbox
```

The retry may repeat the MinIO operation, so that step still needs stable identity or outcome verification. The workflow record ensures work is not forgotten.

This changes the proposed standard:

> Every integration-event consumer must demonstrate replay safety. A transactional processed-event ledger is the preferred mechanism only when the ledger and resulting state share a transaction. Otherwise, use target-side idempotency/versioning or durable workflow state with retry, reconciliation, and compensation.

Additional rules:

- Never claim atomicity across independent services.
- Broker acknowledgement means responsibility is durably completed or accepted—not merely that processing started.
- Every ambiguous failure must be safe to retry or possible to reconcile.
- Each effect must document its identity, completion evidence, and duplicate behavior.
- “Exactly once” is prohibited unless the entire effect is genuinely protected by one transactional boundary.

Should this replay-safety rule replace the universal inbox requirement?

## User

Correct, but I am curious how this concern integrates with the concern of keeping the application separated from the adapters

## Assistant

I’m applying `codebase-design` here because this is precisely a seam question: the application must own the reliability guarantee while the adapter owns the technology-specific mechanism that satisfies it. I’m checking the deepening guidance so the port does not become either a leaky infrastructure wrapper or a vague abstraction.

## Assistant

The application remains separated by owning the **required reliability semantics**, while adapters own **how those semantics are achieved**.

| Application owns | Adapter owns |
|---|---|
| What operation means | MinIO/Redis/OpenSearch commands |
| Stable operation identity | Object keys, Redis keys, document IDs |
| Required duplicate behavior | Conditional writes, versions, checksums |
| Workflow states and transitions | Persistence and transaction mechanics |
| Meaningful failure categories | SDK errors and network failures |
| When responsibility is durably accepted | Broker acknowledgement mechanics |
| Retry/reconciliation policy | Safe technical retries within one attempt |

A port’s interface includes behavioral guarantees, not just its TypeScript signature:

```typescript
interface OriginalArchive {
  /**
   * Preserves one accepted original.
   *
   * Repeating the same operationId and content returns the same result.
   * Reusing the operationId with different content returns a conflict.
   * A successful result means the original can subsequently be retrieved.
   */
  preserveOriginal(request: {
    operationId: UploadOperationId;
    upload: AcceptedUpload;
  }): Promise<PreservedOriginal>;
}
```

The application knows:

- The operation has stable identity.
- Repetition must be safe.
- Success has a durable meaning.
- Conflict and unavailability have different meanings.

It does not know:

- That MinIO is used.
- How bucket or object keys are constructed.
- Whether checksums, conditional writes, or versioning implement the guarantee.
- Which SDK errors occurred.

The MinIO adapter translates that contract:

```typescript
class MinioOriginalArchive implements OriginalArchive {
  async preserveOriginal(request): Promise<PreservedOriginal> {
    // Derive a deterministic key from application identity.
    // Check whether an object already exists.
    // Compare checksums when the outcome is ambiguous.
    // Translate MinIO failures into declared application failures.
  }
}
```

For a multi-resource workflow, the application owns an explicit state machine:

```text
Accepted
   ↓
OriginalPreservationPending
   ↓
OriginalPreserved
   ↓
CatalogProjectionPending
   ↓
Completed
```

It does not attempt one transaction across all resources. Instead, each transition is durable, and each external step has a port with a replay-safety contract.

```text
Application workflow
    ├── OriginalArchive port
    │       └── MinIO adapter
    ├── WallpaperCatalog port
    │       └── OpenSearch adapter
    ├── UploadWorkflow port
    │       └── PostgreSQL adapter
    └── UploadAnnouncements port
            └── Outbox/NATS adapter
```

A particularly important rule is that the application should not receive raw transaction controls:

```typescript
// Wrong: persistence mechanics leak inward
transaction.begin();
database.update(...);
outbox.insert(...);
transaction.commit();
```

Instead, it requests one semantic durable operation:

```typescript
interface UploadWorkflow {
  recordOriginalPreserved(
    transition: OriginalPreservedTransition,
  ): Promise<void>;
}
```

The PostgreSQL adapter implements that operation by updating workflow state and inserting an outbox record atomically.

So separation does not mean the application ignores consistency. It means:

> The application specifies what must remain true; adapters provide technology-specific proofs of that contract.

Contract tests then run each production adapter against the same behavioral suite. An in-memory adapter and a MinIO adapter must both satisfy duplicate, conflict, success, and failure semantics.

Should we make this explicit rule authoritative: **ports declare durability, replay, ordering, and failure semantics; adapters must demonstrate that they satisfy them without leaking their mechanisms inward**?

This applies the interface-and-seam definition from [`codebase-design`](/home/rafaeltab/wallpaperdb/.agents/skills/codebase-design/SKILL.md): an interface includes invariants, error modes, ordering constraints, and performance characteristics—not merely method signatures.

## User

How does the application guarantee that:
1. The inbox record is created
2. The domain model change is persisted
3. The outbox record is created
within the same transaction, when it doesn't have control over transactions?

## Assistant

It cannot guarantee that if it calls three independent ports sequentially:

```typescript
await inbox.record(eventId);
await repository.save(model);
await outbox.add(events);
```

Even if all three happen to use PostgreSQL, each adapter could use a different connection or transaction. The application needs control over the **semantic atomic boundary**, while the adapter controls the database transaction mechanism.

A capability-owned unit-of-work port provides that boundary:

```typescript
// Application-owned contract

export interface WallpaperEventWork {
  runAtomically<T>(
    work: (scope: WallpaperEventScope) => Promise<T>,
  ): Promise<T>;
}

export interface WallpaperEventScope {
  processedEvents: ProcessedWallpaperEvents;
  wallpapers: Wallpapers;
  pendingAnnouncements: PendingWallpaperAnnouncements;
}

export const WALLPAPER_EVENT_WORK = Symbol.for(
  "wallpaperdb.media.wallpaper-event-work",
);
```

The application then defines what must be atomic:

```typescript
class HandleWallpaperOriginalStored {
  constructor(
    @inject(WALLPAPER_EVENT_WORK)
    private readonly work: WallpaperEventWork,
  ) {}

  async execute(command: OriginalStoredCommand): Promise<void> {
    await this.work.runAtomically(async (scope) => {
      const claimed = await scope.processedEvents.claim(
        command.eventId,
      );

      if (!claimed) {
        return; // Already processed
      }

      const wallpaper =
        await scope.wallpapers.find(command.wallpaperId);

      const result = Wallpaper.receiveOriginal(
        wallpaper,
        command.original,
      );

      await scope.wallpapers.save(result.wallpaper);

      for (const announcement of result.announcements) {
        await scope.pendingAnnouncements.schedule(announcement);
      }
    });
  }
}
```

The PostgreSQL adapter supplies transaction-bound implementations:

```typescript
class PostgresWallpaperEventWork
  implements WallpaperEventWork
{
  constructor(private readonly database: Database) {}

  async runAtomically<T>(
    work: (scope: WallpaperEventScope) => Promise<T>,
  ): Promise<T> {
    return this.database.transaction(async (transaction) => {
      const scope: WallpaperEventScope = {
        processedEvents:
          new PostgresProcessedWallpaperEvents(transaction),
        wallpapers:
          new PostgresWallpapers(transaction),
        pendingAnnouncements:
          new PostgresPendingWallpaperAnnouncements(transaction),
      };

      return work(scope);
    });
  }
}
```

The responsibilities are separated cleanly:

- The application declares that claiming the event, saving the domain change, and scheduling announcements form one atomic consistency boundary.
- The application does not know PostgreSQL syntax, connections, isolation APIs, or transaction objects.
- The adapter guarantees that every scoped port uses the same underlying transaction.
- The composition root supplies that adapter.
- Integration tests prove rollback behavior and duplicate handling.

Important restrictions:

- Transaction-scoped objects must not escape the callback.
- Remote calls to MinIO, NATS, Redis, OpenSearch, or other applications must not occur inside this transaction.
- Only changes supported by the same transactional resource belong inside it.
- An outbox relay publishes after commit.
- The NATS driving adapter acknowledges only after `runAtomically` succeeds.
- If external work is required, the transaction records durable workflow state; a later worker performs that replay-safe step.

This may also be modeled as one capability-specific commit operation rather than a callback:

```typescript
interface WallpaperProcessingJournal {
  commitOriginalReceived(
    transition: OriginalReceivedTransition,
  ): Promise<CommitResult>;
}
```

That interface is deeper, but it works best when the application can calculate the transition from already-loaded state using optimistic concurrency. The callback-style unit of work is more flexible when reads and locked decisions must occur inside the transaction.

The general rule should be:

> The application owns atomicity requirements and consistency boundaries. A driven adapter owns the transaction mechanism. Operations that must commit atomically must be exposed through one capability-owned transactional port; separate injected ports must never be assumed to share a transaction.

Should we adopt capability-scoped unit-of-work ports for atomic inbox/state/outbox changes, while prohibiting external adapter calls inside their transaction scopes?

## User

*mind explodes* So basically, we're going to be making all operations that are part of a transaction part of this unit of work port, while keeping all other things part of separate ports?

## Assistant

Yes—exactly, with one important constraint: the unit of work is **capability-scoped**, not a global bag containing every database operation.

```text
Handle incoming event
    │
    ├─ Unit of work
    │    ├─ Claim event ID
    │    ├─ Load domain state
    │    ├─ Apply domain transition
    │    ├─ Save domain state
    │    └─ Add outgoing event to outbox
    │
    ├─ Commit
    │
    └─ Acknowledge incoming message
```

Everything requiring the same atomic commit is exposed through transaction-bound ports inside the unit-of-work scope.

Everything involving a separate transactional resource remains a separate port:

```text
PostgreSQL unit of work
├── processed-event ledger
├── domain persistence
└── outbox

Separate ports
├── OriginalArchive       → MinIO
├── SearchCatalog         → OpenSearch
├── UploadAllowance       → Redis
└── ExternalSomething     → another application
```

Those separate ports must not be called inside the PostgreSQL transaction as though they participate in it. A multi-resource workflow instead becomes:

```text
1. PostgreSQL unit of work:
   record “original preservation pending”

2. Commit

3. OriginalArchive port:
   perform replay-safe MinIO operation

4. PostgreSQL unit of work:
   record “original preserved”
   add integration Clinton to outboxλισ
```

Correction: “add integration event to outbox.”

If the process crashes between steps, durable workflow state tells reconciliation what remains to be done.

Two anti-overengineering rules matter:

- If one driven-port method can hide a simple atomic database operation, it may open and commit its transaction internally; an explicit unit-of-work callback is unnecessary.
- Do not create one application-wide `UnitOfWork` exposing every repository. Define a capability-specific atomic interface containing only operations that must participate in that consistency boundary.

So the distilled rule is:

> Group operations by atomic consistency boundary. Expose transaction-bound capability operations through one unit-of-work port; keep independently transactional effects behind separate ports and coordinate them through durable workflow state.

## User

Give a very brief summary of your current context

## Assistant

I’m in the `/home/rafaeltab/wallpaperdb` repository. WallpaperDB uses GitHub Issues, five canonical triage labels, and domain docs rooted at `CONTEXT-MAP.md`. No implementation task is currently active; one subagent (`research_event_hex`) exists.

## User

Can you give another brief summary of your current context

## Assistant

I’m working in `/home/rafaeltab/wallpaperdb` with repository write access and restricted broader filesystem access. No coding task is active; project guidance covers GitHub Issues, canonical triage labels, and domain documentation.

## User

So nothing about the code guidelines we're discussing then?

## Assistant

Correct—I don’t currently have the code-guideline discussion in my visible context, only the repository-level `AGENTS.md` guidance. It was likely lost during context compaction, so please resend the key points or point me to the relevant file.
