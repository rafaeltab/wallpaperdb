# Prototype the factory frontend

The [factory operations UI](../apps/factory/README.md) is a Vite/React client for the existing HTTP backend. Pinned tools and setup are defined in [mise.toml](../mise.toml) and the [Makefile](../Makefile).

From the repository root, point Vite at the intended backend and start HMR:

```sh
FACTORY_BACKEND_URL=http://127.0.0.1:9400 make run PACKAGE=factory SCRIPT=dev:frontend
```

Replace that URL with the backend's actual private HTTP origin. No machine identity or credentials belong in frontend source. Vite binds loopback and prints its local URL. Open that URL and edit [frontend/src/app.tsx](../apps/factory/frontend/src/app.tsx). Components, CSS and the HTML entry are under [frontend](../apps/factory/frontend/).

The [Vite configuration](../apps/factory/frontend/vite.config.ts) proxies `/api` to `FACTORY_BACKEND_URL`. It translates the Origin of requests from its own page to the backend origin. Other Origins remain unchanged and the backend rejects them. Production uses [the existing HTTP command checks](../apps/factory/src/http/implementation.ts) without a proxy or origin exception. The proxy target is server-side configuration and is never bundled as a client credential.

To run a separate development backend, first build its assets, then use the factory's existing environment setup and command:

```sh
make build PACKAGE=factory
make dev PACKAGE=factory
```

Backend environment and startup are defined by [the factory package scripts](../apps/factory/package.json) and [configuration parser](../apps/factory/src/composition/implementation.ts). Use a new empty `FACTORY_STATE` directory and a separate port for experiments. Never start a development factory against copied production jobs, since observation can advance existing work. Preview is advisory; starting an issue or changing scheduler controls is an explicit real command against the selected backend.

Build, checks and real browser journeys use the repository Make workflow:

```sh
make check PACKAGE=factory
make test-unit PACKAGE=factory
make test-integration PACKAGE=factory
make run PACKAGE=factory SCRIPT=test:e2e
```

The [factory build script](../apps/factory/package.json) places Vite output in `apps/factory/dist/frontend`. [Installation](../apps/factory/scripts/install.mjs) includes it in the pinned release alongside the backend. The backend serves `/` and hashed `/assets` paths from that release, without GitHub/T3 calls or a Vite server. Production activation remains an explicit host operation using the existing installation contract.
