# Plan: @wallpaperdb/react-muuri Package

## Overview

Create a modern React 18/19 compatible wrapper for the Muuri layout library, based on the unmaintained `muuri-react` package API but rewritten for modern React patterns.

## Background

- **Muuri**: v0.9.5 - Stable layout engine with TypeScript support, drag-drop, filtering, sorting
- **muuri-react**: v3.1.7 - Unmaintained for 3 years, broken on React 17+ (API design is solid though)
- **react-muuri**: v0.3.0 - Unmaintained for 7 years, class-based API

Both existing React wrappers are incompatible with React 18+ due to:
- React.StrictMode issues (double-mounting)
- Deprecated lifecycle patterns
- Missing concurrent features support

The muuri-react API (hooks: useData, useDrag, useGrid, useRefresh, useVisibility) is well-designed and React-idiomatic. We'll follow this pattern.

## Goals

1. React 18+ compatible with full StrictMode support
2. TypeScript-first with comprehensive types
3. Hooks-based API based on muuri-react patterns
4. Support all Muuri features: layout, drag-drop, filtering, sorting
5. SSR-safe (works with Next.js, uses 'use client' directive)
6. Follow monorepo conventions
7. TDD approach - tests written before implementation
8. Storybook for visual testing and component documentation

## Package Structure

```
packages/react-muuri/
├── src/
│   ├── index.ts                    # Main exports
│   ├── MuuriGrid.tsx               # Main grid component
│   ├── MuuriItem.tsx               # Individual item component
│   ├── context/
│   │   ├── MuuriContext.tsx        # Grid context provider
│   │   └── ItemContext.tsx         # Item context provider
│   ├── hooks/
│   │   ├── useGrid.ts              # Access grid instance
│   │   ├── useItem.ts              # Access item methods
│   │   ├── useDrag.ts              # Drag state and control
│   │   ├── useFilter.ts            # Filter state management
│   │   ├── useSort.ts              # Sort state management
│   │   ├── useLayout.ts            # Layout control
│   │   └── useRefresh.ts           # Refresh item dimensions
│   ├── types/
│   │   └── index.ts                # All TypeScript types
│   └── utils/
│       ├── item-manager.ts         # Item tracking & lifecycle
│       └── event-bridge.ts         # Muuri events → React state
├── test/
│   ├── MuuriGrid.test.tsx
│   ├── hooks/
│   │   └── *.test.ts
│   └── integration/
│       └── drag-drop.test.tsx
├── stories/
│   ├── MuuriGrid.stories.tsx       # Grid component stories
│   ├── DragAndDrop.stories.tsx     # Drag & drop demos
│   ├── Filtering.stories.tsx       # Filter functionality demos
│   └── Sorting.stories.tsx         # Sort functionality demos
├── .storybook/
│   ├── main.ts                     # Storybook config
│   └── preview.ts                  # Decorators & global styles
├── package.json
├── tsconfig.json
├── biome.json
├── vitest.config.ts
└── README.md
```

## Implementation Phases

### Phase 1: Package Setup & Core Types ✅

### Phase 2: Core Components (TDD) ✅

### Phase 3: Core Hooks (TDD) ← **CURRENT**

---

### Phase 1: Package Setup & Core Types

**Tasks:**
1. Create package.json with React 18+/19 peer dependency + Storybook deps
2. Configure TypeScript (tsconfig.json) with jsx: "react-jsx"
3. Configure Biome (biome.json)
4. Configure Vitest (vitest.config.ts) with jsdom environment
5. Configure Storybook (.storybook/main.ts, preview.ts)
6. Define comprehensive TypeScript types for Muuri options

**Files:**
- `packages/react-muuri/package.json`
- `packages/react-muuri/tsconfig.json`
- `packages/react-muuri/biome.json`
- `packages/react-muuri/vitest.config.ts`
- `packages/react-muuri/.storybook/main.ts`
- `packages/react-muuri/.storybook/preview.ts`
- `packages/react-muuri/src/types/index.ts`

### Phase 2: Core Components (TDD)

**TDD Cycle:** Write tests → Implement → Refactor

**Step 1: Write Tests First**
1. Write tests for MuuriContext (context value shape, provider behavior)
2. Write tests for ItemContext (item registration, context access)
3. Write tests for MuuriGrid (rendering, children handling, lifecycle)
4. Write tests for MuuriItem (registration with grid, cleanup)

**Step 2: Implement to Pass Tests**
1. Create MuuriContext for grid instance sharing
2. Create ItemContext for item-level data
3. Implement MuuriGrid component with:
   - 'use client' directive for Next.js compatibility
   - Proper ref management for Muuri instance
   - StrictMode-safe initialization (useEffect cleanup)
   - Children reconciliation for item add/remove
   - Dynamic Muuri import (avoid SSR issues with window/document)
4. Implement MuuriItem component with:
   - Automatic registration with parent grid
   - Lifecycle management (add on mount, remove on unmount)

**Step 3: Create Stories for Visual Verification**
- Basic grid story with static items
- Dynamic items story (add/remove)

**Key Challenges:**
- React StrictMode double-mounting: Use refs + cleanup patterns
- Imperative Muuri API vs declarative React: Bridge via effects
- Item identity tracking: Use React keys mapped to Muuri items
- SSR safety: Muuri requires DOM, must be client-side only

**Files:**
- `packages/react-muuri/test/context/MuuriContext.test.tsx`
- `packages/react-muuri/test/context/ItemContext.test.tsx`
- `packages/react-muuri/test/MuuriGrid.test.tsx`
- `packages/react-muuri/test/MuuriItem.test.tsx`
- `packages/react-muuri/src/context/MuuriContext.tsx`
- `packages/react-muuri/src/context/ItemContext.tsx`
- `packages/react-muuri/src/MuuriGrid.tsx`
- `packages/react-muuri/src/MuuriItem.tsx`
- `packages/react-muuri/stories/MuuriGrid.stories.tsx`

### Phase 3: Core Hooks (TDD)

**TDD Cycle:** Write tests → Implement → Refactor

**Step 1: Write Tests First**
1. Write tests for `useGrid()` - returns grid instance, methods work
2. Write tests for `useItem()` - returns item state within MuuriItem
3. Write tests for `useLayout()` - triggers layout recalculation
4. Write tests for `useRefresh()` - refreshes item dimensions

**Step 2: Implement to Pass Tests**
1. `useGrid()` - Access grid instance, methods, state
2. `useItem()` - Access item instance within MuuriItem
3. `useLayout()` - Trigger layout recalculation
4. `useRefresh()` - Refresh item dimensions

**Files:**
- `packages/react-muuri/test/hooks/useGrid.test.ts`
- `packages/react-muuri/test/hooks/useItem.test.ts`
- `packages/react-muuri/test/hooks/useLayout.test.ts`
- `packages/react-muuri/test/hooks/useRefresh.test.ts`
- `packages/react-muuri/src/hooks/useGrid.ts`
- `packages/react-muuri/src/hooks/useItem.ts`
- `packages/react-muuri/src/hooks/useLayout.ts`
- `packages/react-muuri/src/hooks/useRefresh.ts`

### Phase 4: Drag & Drop Support (TDD)

**TDD Cycle:** Write tests → Implement → Refactor

**Step 1: Write Tests First**
1. Write tests for `useDrag()` - drag state, startDrag, cancelDrag
2. Write tests for event bridge - Muuri events to React state
3. Write integration tests for drag lifecycle

**Step 2: Implement to Pass Tests**
1. `useDrag()` hook for drag state
2. Event handlers for drag lifecycle
3. Cross-grid drag support
4. Drag placeholder styling

**Step 3: Create Stories for Visual Verification**
- Drag & drop demo story with interactive items
- Cross-grid drag story (if applicable)

**Files:**
- `packages/react-muuri/test/hooks/useDrag.test.ts`
- `packages/react-muuri/test/utils/event-bridge.test.ts`
- `packages/react-muuri/test/integration/drag-drop.test.tsx`
- `packages/react-muuri/src/hooks/useDrag.ts`
- `packages/react-muuri/src/utils/event-bridge.ts`
- `packages/react-muuri/stories/DragAndDrop.stories.tsx`

### Phase 5: Filtering & Sorting (TDD)

**TDD Cycle:** Write tests → Implement → Refactor

**Step 1: Write Tests First**
1. Write tests for `useFilter()` - filter function, state updates
2. Write tests for `useSort()` - sort function, comparator support
3. Write tests for declarative filter/sort via props

**Step 2: Implement to Pass Tests**
1. `useFilter()` hook for filter control
2. `useSort()` hook for sort control
3. Declarative filter/sort via props

**Step 3: Create Stories for Visual Verification**
- Filtering demo story (show/hide items by criteria)
- Sorting demo story (reorder by different keys)

**Files:**
- `packages/react-muuri/test/hooks/useFilter.test.ts`
- `packages/react-muuri/test/hooks/useSort.test.ts`
- `packages/react-muuri/src/hooks/useFilter.ts`
- `packages/react-muuri/src/hooks/useSort.ts`
- `packages/react-muuri/stories/Filtering.stories.tsx`
- `packages/react-muuri/stories/Sorting.stories.tsx`

### Phase 6: Final Documentation & Cleanup

**Tasks:**
1. Verify all tests pass
2. Verify all stories render correctly in Storybook
3. Write README with examples and API reference
4. Run lint and format

**Files:**
- `packages/react-muuri/README.md`

## API Design

### Component API

```tsx
<MuuriGrid
  // Layout options
  layoutDuration={300}
  layoutEasing="ease"
  layoutOnResize={true}

  // Drag options
  dragEnabled={true}
  dragSort={true}
  dragHandle=".drag-handle"

  // Callbacks
  onLayoutEnd={(items) => {}}
  onDragStart={(item, event) => {}}
  onDragEnd={(item, event) => {}}
  onSort={(currentOrder, previousOrder) => {}}

  // Style
  className="my-grid"
>
  {items.map(item => (
    <MuuriItem key={item.id}>
      <div className="card">{item.content}</div>
    </MuuriItem>
  ))}
</MuuriGrid>
```

### Hooks API

```tsx
// Inside MuuriItem
function Card({ data }) {
  const { isDragging, isPositioning } = useItem();
  const { startDrag, cancelDrag } = useDrag();

  return (
    <div className={isDragging ? 'dragging' : ''}>
      {data.content}
    </div>
  );
}

// Inside or outside MuuriGrid
function Controls() {
  const { filter, sort, layout } = useGrid();

  return (
    <button onClick={() => filter(item => item.visible)}>
      Filter Visible
    </button>
  );
}
```

## Dependencies

```json
{
  "peerDependencies": {
    "react": "^18.0.0 || ^19.0.0",
    "react-dom": "^18.0.0 || ^19.0.0"
  },
  "dependencies": {
    "muuri": "^0.9.5"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@testing-library/react": "^16.0.0",
    "jsdom": "^25.0.0",
    "@storybook/react": "^8.0.0",
    "@storybook/react-vite": "^8.0.0",
    "@storybook/addon-essentials": "^8.0.0",
    "storybook": "^8.0.0"
  }
}
```

## Testing Strategy

**TDD Approach:**
- Write tests BEFORE implementation
- Tests define expected behavior
- Implement minimum code to pass tests
- Refactor while keeping tests green

**Test Types:**
1. **Unit tests**: Test hooks in isolation with mock contexts
2. **Component tests**: Test rendering and lifecycle with @testing-library/react
3. **Integration tests**: Test drag-drop and filtering with jsdom
4. **Visual tests**: Storybook stories for visual verification (run `make react-muuri-storybook`)

**Storybook Stories:**
- `MuuriGrid.stories.tsx` - Basic grid, dynamic items
- `DragAndDrop.stories.tsx` - Interactive drag demos
- `Filtering.stories.tsx` - Filter functionality
- `Sorting.stories.tsx` - Sort functionality

## Makefile Targets

Add to root Makefile:
```makefile
react-muuri-build:
	@turbo run build --filter=@wallpaperdb/react-muuri

react-muuri-test:
	@turbo run test --filter=@wallpaperdb/react-muuri

react-muuri-test-watch:
	@pnpm --filter @wallpaperdb/react-muuri test:watch

react-muuri-storybook:
	@pnpm --filter @wallpaperdb/react-muuri storybook

react-muuri-storybook-build:
	@pnpm --filter @wallpaperdb/react-muuri build-storybook
```

## Design Decisions (Confirmed)

1. **React 18+ support** - Support both React 18 and 19
2. **SSR-safe architecture** - Use 'use client' directive, guard against window/document in module scope
3. **API based on muuri-react** - Follow the proven hooks pattern from muuri-react

## Risk Assessment

- **Muuri stability**: v0.9.5 is 4 years old but stable. No breaking changes expected.
- **React 19 APIs**: May need adjustment as React 19 stabilizes.
- **Test complexity**: DOM-based tests for drag-drop are complex but feasible with jsdom.

## Success Criteria

1. All Muuri features accessible via React components/hooks
2. Full TypeScript support with comprehensive types
3. Works correctly in React 18/19 StrictMode
4. SSR-safe (no crashes during server render, works with Next.js)
5. Comprehensive test coverage
6. Clear documentation with examples
