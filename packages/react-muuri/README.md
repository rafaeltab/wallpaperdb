# React Muuri

A React wrapper for [Muuri](https://muuri.dev/) used by the wallpaper masonry gallery. It exists to support React StrictMode lifecycle replay and client-only loading in server-rendered applications.

## Core capabilities

- Renders masonry grids from React components and keeps the layout in sync as items are added or removed.
- Lets components control layout, filtering, and sorting through React hooks.
- Supports drag-and-drop and exposes item visibility, positioning, and drag state so child components can respond to grid interactions.

Use the [package entry point](src/index.ts), [examples](stories), and [tests](test) for component and hook contracts.
