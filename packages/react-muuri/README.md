# @wallpaperdb/react-muuri

A React wrapper for the [Muuri](https://muuri.dev/) grid layout library, rewritten from scratch to support React 18 and 19 with full StrictMode compatibility.

## Key Capabilities

- Renders Muuri grids as a declarative React component tree using `MuuriGrid` and `MuuriItem` components
- Exposes grid control (layout, filter, sort, item management) through React hooks consumable from anywhere inside the grid
- Surfaces per-item state (dragging, positioning, visibility, releasing) via hooks for use in item child components
- Handles React StrictMode's double-mount/unmount lifecycle correctly, avoiding duplicate item registration or orphaned Muuri instances
- Dynamically imports Muuri on the client only, making the package safe to use in SSR environments such as Next.js

## Technology Choices

- **Muuri** — the underlying grid engine responsible for layout calculation, drag-and-drop, filtering, and sorting
- **React context** — grid and item instances are distributed to descendant components without prop drilling, enabling hooks to work at any depth
- **Dynamic import** — Muuri is loaded lazily at runtime to prevent server-side execution of DOM-dependent code
