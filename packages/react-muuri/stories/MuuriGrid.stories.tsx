import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { MuuriGrid } from '../src/MuuriGrid.js';
import { MuuriItem } from '../src/MuuriItem.js';

const meta: Meta<typeof MuuriGrid> = {
  title: 'Components/MuuriGrid',
  component: MuuriGrid,
  parameters: {
    layout: 'padded',
  },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof MuuriGrid>;

// Basic CSS for items
const itemStyle = {
  width: 100,
  height: 100,
  backgroundColor: '#4a90d9',
  borderRadius: 8,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: 'white',
  fontWeight: 'bold',
  margin: 8,
};

const containerStyle = {
  minHeight: 400,
  backgroundColor: '#f5f5f5',
  padding: 16,
  borderRadius: 8,
};

/**
 * Basic grid with static items
 */
export const Basic: Story = {
  render: () => (
    <div style={containerStyle}>
      <MuuriGrid layoutDuration={300}>
        <MuuriItem key="1">
          <div style={itemStyle}>1</div>
        </MuuriItem>
        <MuuriItem key="2">
          <div style={itemStyle}>2</div>
        </MuuriItem>
        <MuuriItem key="3">
          <div style={itemStyle}>3</div>
        </MuuriItem>
        <MuuriItem key="4">
          <div style={itemStyle}>4</div>
        </MuuriItem>
        <MuuriItem key="5">
          <div style={itemStyle}>5</div>
        </MuuriItem>
        <MuuriItem key="6">
          <div style={itemStyle}>6</div>
        </MuuriItem>
      </MuuriGrid>
    </div>
  ),
};

/**
 * Grid with varying item sizes
 */
export const VaryingSizes: Story = {
  render: () => {
    const sizes = [
      { width: 100, height: 100 },
      { width: 150, height: 100 },
      { width: 100, height: 150 },
      { width: 200, height: 100 },
      { width: 100, height: 200 },
      { width: 150, height: 150 },
    ];

    return (
      <div style={containerStyle}>
        <MuuriGrid layoutDuration={300}>
          {sizes.map((size, index) => (
            <MuuriItem key={index}>
              <div
                style={{
                  ...itemStyle,
                  width: size.width,
                  height: size.height,
                  backgroundColor: `hsl(${index * 50}, 70%, 50%)`,
                }}
              >
                {index + 1}
              </div>
            </MuuriItem>
          ))}
        </MuuriGrid>
      </div>
    );
  },
};

/**
 * Interactive grid where items can be added and removed
 */
export const DynamicItems: Story = {
  render: function DynamicItemsStory() {
    const [items, setItems] = useState([1, 2, 3, 4, 5, 6]);
    const [nextId, setNextId] = useState(7);

    const addItem = () => {
      setItems([...items, nextId]);
      setNextId(nextId + 1);
    };

    const removeItem = (id: number) => {
      setItems(items.filter((item) => item !== id));
    };

    return (
      <div>
        <div style={{ marginBottom: 16 }}>
          <button
            type="button"
            onClick={addItem}
            style={{
              padding: '8px 16px',
              marginRight: 8,
              backgroundColor: '#4a90d9',
              color: 'white',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            Add Item
          </button>
        </div>
        <div style={containerStyle}>
          <MuuriGrid layoutDuration={300}>
            {items.map((id) => (
              <MuuriItem key={id}>
                <div
                  style={{
                    ...itemStyle,
                    backgroundColor: `hsl(${id * 30}, 70%, 50%)`,
                    position: 'relative',
                  }}
                >
                  {id}
                  <button
                    type="button"
                    onClick={() => removeItem(id)}
                    style={{
                      position: 'absolute',
                      top: 4,
                      right: 4,
                      width: 20,
                      height: 20,
                      padding: 0,
                      backgroundColor: 'rgba(0,0,0,0.3)',
                      color: 'white',
                      border: 'none',
                      borderRadius: '50%',
                      cursor: 'pointer',
                      fontSize: 12,
                    }}
                  >
                    ×
                  </button>
                </div>
              </MuuriItem>
            ))}
          </MuuriGrid>
        </div>
      </div>
    );
  },
};

/**
 * Grid with drag and drop enabled
 */
export const DragAndDrop: Story = {
  render: () => (
    <div style={containerStyle}>
      <MuuriGrid dragEnabled dragSort layoutDuration={300}>
        {[1, 2, 3, 4, 5, 6].map((id) => (
          <MuuriItem key={id}>
            <div
              style={{
                ...itemStyle,
                cursor: 'grab',
                backgroundColor: `hsl(${id * 50}, 70%, 50%)`,
              }}
            >
              Drag {id}
            </div>
          </MuuriItem>
        ))}
      </MuuriGrid>
    </div>
  ),
};

/**
 * Grid with custom layout animation settings
 */
export const CustomAnimation: Story = {
  render: () => (
    <div style={containerStyle}>
      <MuuriGrid layoutDuration={600} layoutEasing="ease-in-out" showDuration={400} hideDuration={400}>
        {[1, 2, 3, 4, 5, 6, 7, 8].map((id) => (
          <MuuriItem key={id}>
            <div
              style={{
                ...itemStyle,
                backgroundColor: `hsl(${id * 40}, 60%, 55%)`,
              }}
            >
              {id}
            </div>
          </MuuriItem>
        ))}
      </MuuriGrid>
    </div>
  ),
};

/**
 * Grid demonstrating event callbacks
 */
export const WithEventCallbacks: Story = {
  render: function WithEventCallbacksStory() {
    const [events, setEvents] = useState<string[]>([]);

    const logEvent = (name: string) => {
      setEvents((prev) => [...prev.slice(-4), `${new Date().toLocaleTimeString()}: ${name}`]);
    };

    return (
      <div>
        <div style={containerStyle}>
          <MuuriGrid
            dragEnabled
            dragSort
            layoutDuration={300}
            onLayoutStart={() => logEvent('Layout started')}
            onLayoutEnd={() => logEvent('Layout ended')}
            onDragStart={() => logEvent('Drag started')}
            onDragEnd={() => logEvent('Drag ended')}
          >
            {[1, 2, 3, 4].map((id) => (
              <MuuriItem key={id}>
                <div
                  style={{
                    ...itemStyle,
                    cursor: 'grab',
                    backgroundColor: `hsl(${id * 70}, 70%, 50%)`,
                  }}
                >
                  Drag {id}
                </div>
              </MuuriItem>
            ))}
          </MuuriGrid>
        </div>
        <div
          style={{
            marginTop: 16,
            padding: 16,
            backgroundColor: '#333',
            color: '#0f0',
            borderRadius: 8,
            fontFamily: 'monospace',
            fontSize: 12,
            minHeight: 100,
          }}
        >
          <div style={{ marginBottom: 8, fontWeight: 'bold' }}>Event Log:</div>
          {events.length === 0 ? (
            <div style={{ color: '#666' }}>Drag items to see events...</div>
          ) : (
            events.map((event, i) => <div key={i}>{event}</div>)
          )}
        </div>
      </div>
    );
  },
};
