# ProfileStore contract prototype, issue 419

This opt-in experiment asks whether one independently specified contract can
reject a convenient controlled adapter while accepting both the capability-test
adapter and the real PostgreSQL adapter. It introduces no CI gate or production
adapter change. Evidence and the adoption recommendation belong to
[issue 419](https://github.com/rafaeltab/wallpaperdb/issues/419).

## Pilot specification

The subject is the application-owned `ProfileStore` exported by
[the profile capability](../../src/capabilities/profile/index.ts). The normative
transaction promises are in [its declaration](../../src/capabilities/profile/contract.ts).
These requirements are fixed independently of either adapter's algorithms:

- G1 and G2: rejected and unchanged decisions preserve the complete readable
  owner state and append no occurrence. Preserve the rejection value.
- G3: an accepted details transition returns and stores the requested details,
  advances the version once, and appends exactly one occurrence.
- G4: another owner's Handle cannot be acquired. Reject with
  `handle-unavailable`, preserve both owners and the existing claim, and append
  nothing.
- G5: competing decisions for the same owner receive serialized, current locked
  snapshots. If each caller changes only version 1, exactly one may commit.
  The caller owns version comparison, not the adapter.
- G6: `observedAt` is at least `query.now`. Exact wall-clock equality is not promised.
- G7: changing a returned read value, including its mutable Date fields, cannot
  write to storage.
- G8: a throwing decision remains a defect and changes no state or occurrences.
- G9: reading an absent owner returns `null` and creates no occurrence.

G1 through G6 derive from the declaration's locked snapshot, atomic commit, no-write,
conflict, and observed-time promises. The version increment in G3 is a pilot
clarification supported by the existing public
[profile capability tests](../profile-capability.unit.test.ts) and
[transaction tests](../profile-store.integration.test.ts). G7 is an existing
promise of [the controlled helper](../helpers/profiles.ts), and is necessary for
read-only persistence semantics. Before adopting this suite as policy, put these
two clarifications in the application-owned port declaration. G8 also follows
the [failure policy](../../../../docs/coding-standards/application-and-domain.md#outcomes-and-failures).
G9 follows the explicit nullable read result. These are observable requirements,
not expected SQL, collection operations, or a copy of production's algorithm.

The probe does not specify concurrent `create` return values, exact timestamps,
event identities, claim generation values, which concurrent caller wins,
database isolation levels, cancellation after ambiguous commit, history order,
picture adoption, or resource-failure behavior. It does not duplicate biography,
authorization, cooldown, and normalization decisions owned by capability tests.
G5 uses one minimal caller decision to exercise locking rather than retesting
the full capability matrix.

## Run

From the repository root after normal contributor setup:

```sh
# All controls and the existing controlled capability adapter, without Docker.
make test-focused PACKAGE=user ARGS='--config vitest.prototype-adapter-contracts.config.ts controlled.probe.ts controls.probe.ts'

# Same nine cases against the production adapter and real PostgreSQL.
# First verify the shared lock is safe as required by CONTRIBUTING.md.
flock -w 900 /tmp/wallpaperdb-perf-validation.lock make test-focused PACKAGE=user ARGS='--config vitest.prototype-adapter-contracts.config.ts postgres.probe.ts'

# Deliberately nonzero run showing the incompatible adapter's raw diagnostic.
PROTOTYPE_419_RAW_CONTROL=stale-snapshot make test-focused PACKAGE=user ARGS='--config vitest.prototype-adapter-contracts.config.ts controls.probe.ts -t "stale-snapshot.*G5"'

# Representative existing capability and PostgreSQL tests, serially.
flock -w 900 /tmp/wallpaperdb-perf-validation.lock make test-focused PACKAGE=user ARGS='test/profile-capability.unit.test.ts test/profile-store.integration.test.ts test/profile-transactions.integration.test.ts'
```

The config is the explicit opt-in. Ordinary suites select `*.test.ts` and never
select these `*.probe.ts` files. Standard lint and type checks still examine
their TypeScript. Test and hook deadlines are in
[the config](../../vitest.prototype-adapter-contracts.config.ts).

## Fixtures and controls

[The shared cases](contract.ts) operate through public `ProfileStore` methods.
They do not inspect SQL or depend on the other implementation's results.
Occurrence count is an adapter-specific observation of the declared effect:
the controlled adapter's recorded transitions, and production's public
`MaintenanceStore.pendingEvents`. This checks count, not event payload fidelity
or crash durability. The existing PostgreSQL transaction tests retain those
distinct infrastructure checks.

Each controlled case creates fresh state. PostgreSQL uses one disposable labeled
Testcontainers container with a fresh database and real migrations for every
case. It checks empty profile/event state, reuses fixed owner IDs, disposes Effect
resources and clients, drops its own database, and verifies removal. Partial setup
and assertion failures take the same cleanup path. A final cleanup attempts any
remaining owned databases, closes the admin client, and stops only its container.
No shared development database is touched. Docker-heavy runs must hold the
[shared host lock](../../../../CONTRIBUTING.md#check-a-change).

[Controls](controls.ts) wrap the actual controlled adapter used by repository
capability tests. Four incompatible controls commit a rejected decision, commit
an unchanged decision, omit accepted occurrences, or give decisions a stale
version. All also run one real `Profiles.ensure` / `Profiles.updateDetails` happy
path. Positive controls use the unmodified adapter and a valid later observation
time. The missing-asset control intentionally escapes this contract; a separate
asset lookup witness proves it is a real fault. Normal probe runs require the
expected guarantee-specific assertion failures. The raw mode prints those
failures and exits nonzero, so setup errors cannot masquerade as detections.

## Participation and limits

Participation is explicit in `controlled.probe.ts` and `postgres.probe.ts`.
Both import the same case list, so adding a case automatically tests these two
participants. A new factory or controlled helper participates only after an
owner registers it. TypeScript structural typing cannot discover all adapters,
and naming scans cannot prove that capability tests use a registered factory.

For adoption, keep a small capability-owned participant list and review changes
to port declarations, adapter factories, and capability-test helpers together.
Initially run controlled cases in unit CI and production cases in serial
integration CI, with case-specific infrastructure setup. Keep capability
decisions in capability tests. Add one more stateful port only after its owner
declares guarantees and observes an actual risk of divergence. Do not build a
generic contract registry or require every port to fit this fixture shape.

The fixture code and effect observations add maintenance cost. Shared cases
remove duplicated guarantee assertions, but do not replace production-specific
rollback, cancellation, constraint translation, event payload, and resource
cleanup tests. Matching adapters can share an untested bug. The missing-asset
control is a concrete example of the limits of a contract with partial coverage.
