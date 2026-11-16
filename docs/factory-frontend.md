# Develop the factory frontend

The [factory frontend](../apps/factory/frontend/) opens the canvas UI by default. It consumes the [v2 HTTP contract](factory-interface-v2.md) through [the typed client](../apps/factory/frontend/src/canvas/client.ts). The existing v1 operations UI remains available at `?view=operations`. Tools and setup are defined in [mise.toml](../mise.toml) and the [Makefile](../Makefile).

## Run with fake data

Start the isolated [v2 fake server](../apps/factory/src/http/v2/demo.ts) in one terminal:

```sh
make run PACKAGE=factory SCRIPT=dev:interface-v2
```

Start Vite in another terminal:

```sh
FACTORY_BACKEND_URL=http://127.0.0.1:9402 make run PACKAGE=factory SCRIPT=dev:frontend
```

Open the local URL Vite prints. The board identifies fake data. Configure, start, resume, cancel and preview commands change only the fake server's process-local state. Restarting that server resets the sample. This frontend change does not implement or deploy a live v2 producer.

The [canvas app](../apps/factory/frontend/src/canvas/app.tsx) owns navigation and presentation. Layout, collapse and relationship selection stay client-side. The [polling integration](../apps/factory/frontend/src/canvas/use-factory.ts) fetches conditional snapshots at the server's suggested interval, bounded to 1–30 seconds. Snapshots replace the board atomically; this client does not require SSE or delta support. Failed refreshes retain the prior board and block new commands until observations recover. A lost command response retains its UUID for receipt observation or an explicit retry of the same request.

The [layout](../apps/factory/frontend/src/canvas/geometry.ts) sorts the approximate work order by priority, size and issue number. For each rank it places unavailable ordering before known ranks, with known unmarked fields last. Both unavailable project data and a named option with an unknown rank retain that distinction. Ties use issue-number order. This order is packed upward from the bottom of each issue section.

The [Start panel](../apps/factory/frontend/src/canvas/panels.tsx) keeps the execution-context draft while revalidating current actions. Changed authorization requires reselection; a page reset keeps a selection confirmed by the current board.

## Select a backend

Set `FACTORY_BACKEND_URL` to the backend's private HTTP origin. No machine identity or credentials belong in frontend source. The [Vite configuration](../apps/factory/frontend/vite.config.ts) proxies `/api` to that origin. It translates requests from its own development page to the backend origin; other Origins remain unchanged. Production uses the backend's origin checks without a development proxy.

For the existing v1 backend, use `?view=operations` and select its actual port, normally 9400. The canvas needs a v2 producer; it does not infer missing v2 data from v1 observations. Never start a development factory against copied production jobs, since observation can advance existing work. Backend setup and activation remain documented in [factory operations](../apps/factory/OPERATIONS.md).

## Verify changes

The [factory package](../apps/factory/package.json) owns the frontend build and checks:

```sh
make check PACKAGE=factory
make test-unit PACKAGE=factory
make test-integration PACKAGE=factory
```

The [browser integration journey](../apps/factory/frontend/test/canvas.integration.test.ts) exercises the actual Vite proxy and fake HTTP server. Set `FACTORY_DEMO_DIRECTORY` to an outside-repository directory when running it to retain a recording and screenshot.

The [factory build script](../apps/factory/package.json) places Vite output in `apps/factory/dist/frontend`. [Installation](../apps/factory/scripts/install.ts) includes it in the pinned release alongside the backend. The backend serves `/` and hashed `/assets` paths from that release, without GitHub/T3 calls or a Vite server. Production activation remains an explicit host operation using the existing installation contract.

## Measure canvas expansion

Run the [expansion budget check](../apps/factory/frontend/scripts/benchmark-project-canvas-expansion.ts) separately from coverage-instrumented correctness checks:

```sh
make run PACKAGE=factory SCRIPT=bench:project-canvas-expansion ARGS='--rounds 5'
```

The check builds the production frontend and runs Chromium and Firefox against controlled HTTP responses. It uses three fixed synthetic 100-item scenes, including a 75-link scene, without connecting to a running backend. It measures both the first expansion of previously uncomputed routes and repeat expansion from all collapsed. Timing starts at the Expand all click and includes matching expanded placement and dependency-link paths plus the next animation-frame boundary. Every measured current sample must be below the default 100 ms budget; a failure exits nonzero. The output retains individual samples and observed ranges rather than hiding slow runs.

The [saved expectations](../apps/factory/frontend/test/fixtures/canvas/expansion100.json) preserve original placement and link geometry. Keep these expectations fixed when optimizing. The existing [routing suite](../apps/factory/frontend/test/item-dependency-links.unit.test.ts) checks additional title modes, collapsed scenes, and routing failures.

Use `--report-only` to capture a failing performance baseline while still enforcing output correctness. Use `--compare-source /path/to/frozen/frontend` to alternate the current and reference production builds within each round; the timing budget applies to the current build and correctness applies to both. These measurements describe the selected host, browsers, workload, and build mode, rather than a hardware-independent latency guarantee.

Set `FACTORY_DEMO_DIRECTORY` to retain a video of each expansion scenario for a demonstration. Recorded runs label their timings as demonstration data; use an unrecorded run for performance acceptance.
