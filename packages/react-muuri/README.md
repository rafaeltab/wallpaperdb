# @wallpaperdb/react-muuri

Modern React 18/19 compatible wrapper for the [Muuri](https://muuri.dev/) layout library. Based on `muuri-react` API patterns but rewritten for modern React with full StrictMode support.

## Features

- **React 18/19 Compatible** - Full StrictMode support with proper cleanup
- **TypeScript-First** - Comprehensive types for all APIs
- **Hooks-Based API** - Modern functional patterns
- **SSR-Safe** - Works with Next.js (client-side only rendering)
- **All Muuri Features** - Layout, drag-drop, filtering, sorting

## Installation

```bash
pnpm add @wallpaperdb/react-muuri
```

**Peer Dependencies:**
- `react` ^18.0.0 || ^19.0.0
- `react-dom` ^18.0.0 || ^19.0.0

## Quick Start

```tsx
import { MuuriGrid, MuuriItem, useDrag } from '@wallpaperdb/react-muuri';

function DraggableCard({ id }) {
  const { isDragging } = useDrag();

  return (
    <div style={{ opacity: isDragging ? 0.5 : 1 }}>
      Card {id}
    </div>
  );
}

function App() {
  const items = [1, 2, 3, 4, 5, 6];

  return (
    <MuuriGrid dragEnabled dragSort>
      {items.map(id => (
        <MuuriItem key={id}>
          <DraggableCard id={id} />
        </MuuriItem>
      ))}
    </MuuriGrid>
  );
}
```

## Components

### MuuriGrid

Main container component that wraps Muuri items.

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

  // Animation options
  showDuration={300}
  hideDuration={300}

  // Event callbacks
  onLayoutEnd={(items) => {}}
  onDragStart={(item, event) => {}}
  onDragEnd={(item, event) => {}}
  onSort={(currentOrder, previousOrder) => {}}

  // Standard HTML attributes
  className="my-grid"
  style={{ minHeight: 400 }}
>
  {children}
</MuuriGrid>
```

### MuuriItem

Wrapper for individual grid items. Must be a direct child of MuuriGrid.

```tsx
<MuuriItem key={uniqueId} itemKey={optionalCustomKey}>
  <YourComponent />
</MuuriItem>
```

## Hooks

### useGrid

Access the grid instance and control methods.

```tsx
function GridControls() {
  const { grid, layout, filter, sort, getItems, refreshItems } = useGrid();

  return (
    <>
      <button onClick={() => layout()}>Relayout</button>
      <button onClick={() => filter(item => item.isActive())}>Filter</button>
      <button onClick={() => sort('data-order')}>Sort</button>
    </>
  );
}
```

### useItem

Access item state and instance within a MuuriItem.

```tsx
function Card({ children }) {
  const { item, isDragging, isPositioning, isVisible, isShowing, isHiding, isReleasing } = useItem();

  return (
    <div className={isDragging ? 'dragging' : ''}>
      {children}
      {isPositioning && <Spinner />}
    </div>
  );
}
```

### useDrag

Access drag-specific state.

```tsx
function DraggableCard({ children }) {
  const { isDragging, isReleasing } = useDrag();

  return (
    <div style={{
      opacity: isDragging ? 0.5 : 1,
      cursor: isDragging ? 'grabbing' : 'grab'
    }}>
      {children}
    </div>
  );
}
```

### useLayout

Trigger layout recalculation.

```tsx
function ResizableContent() {
  const { layout } = useLayout();

  const handleResize = () => {
    // After content changes size
    layout();
  };

  return <Resizable onResize={handleResize}>Content</Resizable>;
}
```

### useRefresh

Refresh item dimensions.

```tsx
function DynamicCard({ content }) {
  const { refresh } = useRefresh();

  useEffect(() => {
    // Refresh dimensions after content changes
    refresh();
  }, [content, refresh]);

  return <div>{content}</div>;
}
```

### useFilter

Filter grid items.

```tsx
function FilterControls() {
  const { filter } = useFilter();

  return (
    <>
      <button onClick={() => filter('.active')}>Show Active</button>
      <button onClick={() => filter(item => item.isVisible())}>Show Visible</button>
      <button onClick={() => filter(() => true)}>Show All</button>
    </>
  );
}
```

### useSort

Sort grid items.

```tsx
function SortControls() {
  const { sort } = useSort();

  return (
    <>
      <button onClick={() => sort('data-order')}>Sort by Order</button>
      <button onClick={() => sort('data-name', { descending: true })}>Sort by Name (Z-A)</button>
      <button onClick={() => sort((a, b) => a.getWidth() - b.getWidth())}>Sort by Width</button>
    </>
  );
}
```

## Event Callbacks

All Muuri events are available as callback props on MuuriGrid:

```tsx
<MuuriGrid
  // Lifecycle
  onSynchronize={() => {}}
  onDestroy={() => {}}

  // Layout
  onLayoutStart={(items, isInstant) => {}}
  onLayoutEnd={(items) => {}}
  onLayoutAbort={(items) => {}}

  // Add/Remove
  onAdd={(items) => {}}
  onRemove={(items, indices) => {}}

  // Visibility
  onShowStart={(items) => {}}
  onShowEnd={(items) => {}}
  onHideStart={(items) => {}}
  onHideEnd={(items) => {}}

  // Filter/Sort
  onFilter={(shownItems, hiddenItems) => {}}
  onSort={(currentOrder, previousOrder) => {}}
  onMove={(data) => {}}

  // Drag
  onDragInit={(item, event) => {}}
  onDragStart={(item, event) => {}}
  onDragMove={(item, event) => {}}
  onDragScroll={(item, event) => {}}
  onDragEnd={(item, event) => {}}
  onDragReleaseStart={(item) => {}}
  onDragReleaseEnd={(item) => {}}

  // Cross-grid
  onSend={(data) => {}}
  onBeforeSend={(data) => {}}
  onReceive={(data) => {}}
  onBeforeReceive={(data) => {}}
/>
```

## Advanced Usage

### Drag with Handle

```tsx
<MuuriGrid dragEnabled dragSort dragHandle=".handle">
  <MuuriItem key="1">
    <div>
      <div className="handle">Drag here</div>
      <div>Content (not draggable)</div>
    </div>
  </MuuriItem>
</MuuriGrid>
```

### Drag Placeholder

```tsx
<MuuriGrid
  dragEnabled
  dragSort
  dragPlaceholder={{
    enabled: true,
    createElement: (item) => {
      const el = document.createElement('div');
      el.className = 'placeholder';
      return el;
    },
  }}
>
  {children}
</MuuriGrid>
```

### Filtering with Search

```tsx
function SearchableGrid({ items }) {
  const [searchTerm, setSearchTerm] = useState('');

  function SearchBox() {
    const { filter } = useFilter();

    const handleSearch = (term) => {
      setSearchTerm(term);
      filter(item => {
        const text = item.getElement().textContent?.toLowerCase() ?? '';
        return text.includes(term.toLowerCase());
      });
    };

    return <input onChange={e => handleSearch(e.target.value)} />;
  }

  return (
    <MuuriGrid>
      <SearchBox />
      {items.map(item => (
        <MuuriItem key={item.id}>
          <Card>{item.name}</Card>
        </MuuriItem>
      ))}
    </MuuriGrid>
  );
}
```

## CSS Requirements

Muuri requires minimal CSS to function:

```css
.muuri {
  position: relative;
}

.muuri-item {
  position: absolute;
}

.muuri-item-content {
  position: relative;
}
```

MuuriGrid automatically applies `position: relative` to itself.

## TypeScript

All components and hooks are fully typed:

```tsx
import type {
  MuuriGridProps,
  MuuriItemProps,
  UseGridReturn,
  UseItemReturn,
  UseDragReturn,
  UseLayoutReturn,
  UseRefreshReturn,
  UseFilterReturn,
  UseSortReturn,
  MuuriInstance,
  MuuriItem,
} from '@wallpaperdb/react-muuri';
```

## Storybook

Run Storybook to see interactive examples:

```bash
make react-muuri-storybook
```

## License

MIT
