import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { MuuriGrid } from '../src/MuuriGrid.js';
import { MuuriItem } from '../src/MuuriItem.js';
import { useDrag } from '../src/hooks/useDrag.js';
import { useItem } from '../src/hooks/useItem.js';
import { useGrid } from '../src/hooks/useGrid.js';

const meta: Meta = {
  title: 'Features/Drag and Drop',
  parameters: {
    layout: 'padded',
  },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj;

// Shared styles
const containerStyle = {
  minHeight: 400,
  backgroundColor: '#f5f5f5',
  padding: 16,
  borderRadius: 8,
};

const baseItemStyle = {
  width: 100,
  height: 100,
  borderRadius: 8,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: 'white',
  fontWeight: 'bold' as const,
  margin: 8,
  cursor: 'grab',
  transition: 'transform 0.2s, box-shadow 0.2s, opacity 0.2s',
};

/**
 * Draggable item that uses useDrag hook to show drag state
 */
function DraggableCard({ id, color }: { id: number; color: string }) {
  const { isDragging, isReleasing } = useDrag();

  return (
    <div
      style={{
        ...baseItemStyle,
        backgroundColor: color,
        opacity: isDragging ? 0.7 : 1,
        transform: isDragging ? 'scale(1.05)' : 'scale(1)',
        boxShadow: isDragging ? '0 10px 30px rgba(0,0,0,0.3)' : '0 2px 5px rgba(0,0,0,0.1)',
        cursor: isDragging ? 'grabbing' : 'grab',
      }}
    >
      <div style={{ textAlign: 'center' }}>
        <div>{id}</div>
        {isDragging && <div style={{ fontSize: 10, marginTop: 4 }}>Dragging!</div>}
        {isReleasing && <div style={{ fontSize: 10, marginTop: 4 }}>Releasing...</div>}
      </div>
    </div>
  );
}

/**
 * Basic drag and drop with visual feedback using useDrag hook
 */
export const BasicDragAndDrop: Story = {
  render: () => (
    <div style={containerStyle}>
      <p style={{ marginBottom: 16, color: '#666' }}>
        Drag items to reorder. Items show visual feedback when being dragged.
      </p>
      <MuuriGrid dragEnabled dragSort layoutDuration={300}>
        {Array.from({ length: 30 }, (_, i) => i + 1).map((id) => (
          <MuuriItem key={id}>
            <DraggableCard id={id} color={`hsl(${(id * 12) % 360}, 70%, 50%)`} />
          </MuuriItem>
        ))}
      </MuuriGrid>
    </div>
  ),
};

/**
 * Card with drag handle - only the handle area initiates drag
 */
function CardWithHandle({ id, color }: { id: number; color: string }) {
  const { isDragging } = useDrag();

  return (
    <div
      style={{
        width: 150,
        height: 100,
        backgroundColor: color,
        borderRadius: 8,
        margin: 8,
        overflow: 'hidden',
        opacity: isDragging ? 0.7 : 1,
        boxShadow: isDragging ? '0 10px 30px rgba(0,0,0,0.3)' : '0 2px 5px rgba(0,0,0,0.1)',
      }}
    >
      {/* Handle area */}
      <div
        className="drag-handle"
        style={{
          backgroundColor: 'rgba(0,0,0,0.2)',
          padding: '8px',
          cursor: isDragging ? 'grabbing' : 'grab',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <span style={{ fontSize: 16 }}>⠿</span>
        <span style={{ color: 'white', fontWeight: 'bold' }}>Item {id}</span>
      </div>
      {/* Content area - not draggable */}
      <div
        style={{
          padding: 12,
          color: 'white',
          fontSize: 14,
        }}
      >
        Drag by the handle above
      </div>
    </div>
  );
}

/**
 * Drag with handle - only the designated handle area can initiate drag
 */
export const DragWithHandle: Story = {
  render: () => (
    <div style={containerStyle}>
      <p style={{ marginBottom: 16, color: '#666' }}>
        Only the handle (top bar with grip icon) can be used to drag items.
      </p>
      <MuuriGrid dragEnabled dragSort dragHandle=".drag-handle" layoutDuration={300}>
        {Array.from({ length: 30 }, (_, i) => i + 1).map((id) => (
          <MuuriItem key={id}>
            <CardWithHandle id={id} color={`hsl(${(id * 12) % 360}, 70%, 45%)`} />
          </MuuriItem>
        ))}
      </MuuriGrid>
    </div>
  ),
};

/**
 * Item with detailed state display
 */
function DetailedStateCard({ id }: { id: number }) {
  const { item, isDragging, isPositioning, isVisible } = useItem();
  const { isReleasing } = useDrag();

  return (
    <div
      style={{
        width: 140,
        height: 120,
        backgroundColor: isDragging ? '#2ecc71' : '#3498db',
        borderRadius: 8,
        margin: 8,
        padding: 12,
        color: 'white',
        fontSize: 11,
        cursor: 'grab',
        opacity: isDragging ? 0.8 : 1,
      }}
    >
      <div style={{ fontWeight: 'bold', marginBottom: 8 }}>Item {id}</div>
      <div style={{ lineHeight: 1.6 }}>
        <div>isDragging: {String(isDragging)}</div>
        <div>isReleasing: {String(isReleasing)}</div>
        <div>isPositioning: {String(isPositioning)}</div>
        <div>isVisible: {String(isVisible)}</div>
        <div>hasItem: {item ? 'yes' : 'no'}</div>
      </div>
    </div>
  );
}

/**
 * Debug view showing all item states from useItem and useDrag hooks
 */
export const StateDebugView: Story = {
  render: () => (
    <div style={containerStyle}>
      <p style={{ marginBottom: 16, color: '#666' }}>
        Debug view showing real-time state from useItem and useDrag hooks.
      </p>
      <MuuriGrid dragEnabled dragSort layoutDuration={300}>
        {Array.from({ length: 20 }, (_, i) => i + 1).map((id) => (
          <MuuriItem key={id}>
            <DetailedStateCard id={id} />
          </MuuriItem>
        ))}
      </MuuriGrid>
    </div>
  ),
};

/**
 * Grid controls component using useGrid hook
 */
function GridControls() {
  const { layout, getItems, grid } = useGrid();
  const [itemCount, setItemCount] = useState(0);

  const handleRefresh = () => {
    layout(true);
    setItemCount(getItems().length);
  };

  return (
    <div
      style={{
        marginBottom: 16,
        padding: 12,
        backgroundColor: '#333',
        borderRadius: 8,
        color: 'white',
        display: 'flex',
        gap: 12,
        alignItems: 'center',
      }}
    >
      <button
        type="button"
        onClick={handleRefresh}
        style={{
          padding: '8px 16px',
          backgroundColor: '#4a90d9',
          color: 'white',
          border: 'none',
          borderRadius: 4,
          cursor: 'pointer',
        }}
      >
        Refresh Layout
      </button>
      <span>Grid: {grid ? 'initialized' : 'loading...'}</span>
      {itemCount > 0 && <span>Items: {itemCount}</span>}
    </div>
  );
}

/**
 * Interactive grid with controls using useGrid hook
 */
export const WithGridControls: Story = {
  render: () => (
    <MuuriGrid dragEnabled dragSort layoutDuration={300}>
      <GridControls />
      {Array.from({ length: 30 }, (_, i) => i + 1).map((id) => (
        <MuuriItem key={id}>
          <DraggableCard id={id} color={`hsl(${(id * 12) % 360}, 70%, 50%)`} />
        </MuuriItem>
      ))}
    </MuuriGrid>
  ),
};

/**
 * Large grid with many draggable items
 */
export const LargeGrid: Story = {
  render: () => (
    <div style={containerStyle}>
      <p style={{ marginBottom: 16, color: '#666' }}>
        Large grid with 120 draggable items. Performance test for drag and drop.
      </p>
      <MuuriGrid dragEnabled dragSort layoutDuration={200}>
        {Array.from({ length: 120 }, (_, i) => i + 1).map((id) => (
          <MuuriItem key={id}>
            <DraggableCard id={id} color={`hsl(${(id * 3) % 360}, 70%, 50%)`} />
          </MuuriItem>
        ))}
      </MuuriGrid>
    </div>
  ),
};

/**
 * Drag with placeholder visualization
 */
export const WithPlaceholder: Story = {
  render: () => (
    <div style={containerStyle}>
      <p style={{ marginBottom: 16, color: '#666' }}>
        When dragging, a placeholder shows where the item will be placed.
      </p>
      <MuuriGrid
        dragEnabled
        dragSort
        layoutDuration={300}
        dragPlaceholder={{
          enabled: true,
          createElement: (_item) => {
            const el = document.createElement('div');
            el.style.cssText = `
              width: 100%;
              height: 100%;
              background: repeating-linear-gradient(
                45deg,
                #ddd,
                #ddd 10px,
                #eee 10px,
                #eee 20px
              );
              border-radius: 8px;
              border: 2px dashed #999;
            `;
            return el;
          },
        }}
      >
        {Array.from({ length: 30 }, (_, i) => i + 1).map((id) => (
          <MuuriItem key={id}>
            <DraggableCard id={id} color={`hsl(${(id * 12) % 360}, 70%, 50%)`} />
          </MuuriItem>
        ))}
      </MuuriGrid>
    </div>
  ),
};
