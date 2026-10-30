# React Muuri

A React wrapper for [Muuri](https://muuri.dev/) used by the wallpaper masonry gallery. It exists to support React StrictMode lifecycle replay and client-only loading in server-rendered applications.

## Core capabilities

- Renders masonry grids from React components and keeps the layout in sync as items are added or removed.
- Lets components control layout, filtering, and sorting through React hooks.
- Supports drag-and-drop and exposes item visibility, positioning, and drag state so child components can respond to grid interactions.

Use the [package entry point](src/index.ts), [examples](stories), and [tests](test) for component and hook contracts.

## Testing

The `useGrid` integration suite runs in Chromium through Vitest's Playwright provider. Its readiness assertion exercises native Muuri initialization, which reads computed styles. Running it in a browser avoids measuring JSDOM's cold style-calculation work as part of hook readiness. The remaining suites use JSDOM.

The [workspace scripts](package.json) select the unit and browser integration projects and install their Chromium dependency. See [checkout validation](../../CONTRIBUTING.md#check-a-change) for browser prerequisites and Make commands. Both projects retain file parallelism and per-file isolation.
