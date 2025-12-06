import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { MuuriGrid } from '../src/MuuriGrid.js';
import { MuuriItem } from '../src/MuuriItem.js';
import { useSort } from '../src/hooks/useSort.js';

const meta: Meta = {
  title: 'Features/Sorting',
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

const buttonStyle = {
  padding: '8px 16px',
  marginRight: 8,
  marginBottom: 8,
  backgroundColor: '#4a90d9',
  color: 'white',
  border: 'none',
  borderRadius: 4,
  cursor: 'pointer',
};

const activeButtonStyle = {
  ...buttonStyle,
  backgroundColor: '#2ecc71',
};

// Sample data
interface Product {
  id: number;
  name: string;
  price: number;
  rating: number;
  date: string;
}

const products: Product[] = [
  { id: 1, name: 'Laptop', price: 999, rating: 4.5, date: '2024-01-15' },
  { id: 2, name: 'Mouse', price: 29, rating: 4.8, date: '2024-03-20' },
  { id: 3, name: 'Keyboard', price: 149, rating: 4.2, date: '2024-02-10' },
  { id: 4, name: 'Monitor', price: 399, rating: 4.6, date: '2024-01-05' },
  { id: 5, name: 'Headphones', price: 199, rating: 4.9, date: '2024-04-01' },
  { id: 6, name: 'Webcam', price: 79, rating: 4.0, date: '2024-02-28' },
  { id: 7, name: 'USB Hub', price: 49, rating: 4.3, date: '2024-03-15' },
  { id: 8, name: 'Mousepad', price: 19, rating: 4.7, date: '2024-01-20' },
];

/**
 * Product card component
 */
function ProductCard({ product }: { product: Product }) {
  return (
    <div
      data-price={product.price}
      data-rating={product.rating}
      data-date={product.date}
      data-name={product.name}
      style={{
        width: 140,
        height: 120,
        backgroundColor: '#3498db',
        borderRadius: 8,
        margin: 8,
        padding: 12,
        color: 'white',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
      }}
    >
      <div style={{ fontWeight: 'bold', fontSize: 14 }}>{product.name}</div>
      <div style={{ fontSize: 12, opacity: 0.9 }}>
        <div>${product.price}</div>
        <div>★ {product.rating}</div>
      </div>
    </div>
  );
}

/**
 * Sort controls component
 */
function SortControls({
  activeSort,
  onSortChange,
}: {
  activeSort: string;
  onSortChange: (sort: string) => void;
}) {
  const { sort } = useSort();

  const applySort = (sortKey: string, descending = false) => {
    onSortChange(sortKey + (descending ? '-desc' : ''));
    sort(`data-${sortKey}`, { descending });
  };

  return (
    <div style={{ marginBottom: 16 }}>
      <span style={{ marginRight: 8, color: '#666' }}>Sort by:</span>
      <button
        type="button"
        style={activeSort === 'name' ? activeButtonStyle : buttonStyle}
        onClick={() => applySort('name')}
      >
        Name (A-Z)
      </button>
      <button
        type="button"
        style={activeSort === 'name-desc' ? activeButtonStyle : buttonStyle}
        onClick={() => applySort('name', true)}
      >
        Name (Z-A)
      </button>
      <button
        type="button"
        style={activeSort === 'price' ? activeButtonStyle : buttonStyle}
        onClick={() => applySort('price')}
      >
        Price ↑
      </button>
      <button
        type="button"
        style={activeSort === 'price-desc' ? activeButtonStyle : buttonStyle}
        onClick={() => applySort('price', true)}
      >
        Price ↓
      </button>
    </div>
  );
}

/**
 * Basic sorting with data attributes
 */
export const BasicSorting: Story = {
  render: function BasicSortingStory() {
    const [activeSort, setActiveSort] = useState('name');

    return (
      <div style={containerStyle}>
        <MuuriGrid layoutDuration={300}>
          <SortControls activeSort={activeSort} onSortChange={setActiveSort} />
          {products.map((product) => (
            <MuuriItem key={product.id}>
              <ProductCard product={product} />
            </MuuriItem>
          ))}
        </MuuriGrid>
      </div>
    );
  },
};

/**
 * Multi-criteria sorting
 */
export const MultiCriteriaSorting: Story = {
  render: function MultiCriteriaSortingStory() {
    function MultiSortControls() {
      const { sort } = useSort();

      return (
        <div style={{ marginBottom: 16 }}>
          <p style={{ color: '#666', marginBottom: 8 }}>Sort by multiple criteria:</p>
          <button
            type="button"
            style={buttonStyle}
            onClick={() => sort(['data-rating', 'data-price'], { descending: true })}
          >
            Best Value (Rating ↓, then Price ↓)
          </button>
          <button
            type="button"
            style={buttonStyle}
            onClick={() => sort(['data-price', 'data-rating'])}
          >
            Budget Friendly (Price ↑, then Rating ↑)
          </button>
        </div>
      );
    }

    return (
      <div style={containerStyle}>
        <MuuriGrid layoutDuration={300}>
          <MultiSortControls />
          {products.map((product) => (
            <MuuriItem key={product.id}>
              <ProductCard product={product} />
            </MuuriItem>
          ))}
        </MuuriGrid>
      </div>
    );
  },
};

/**
 * Custom comparer function
 */
export const CustomComparer: Story = {
  render: function CustomComparerStory() {
    function CustomSortControls() {
      const { sort } = useSort();

      const sortByRating = () => {
        sort((itemA, itemB) => {
          const elA = itemA.getElement();
          const elB = itemB.getElement();
          const ratingA = parseFloat(
            elA.querySelector('[data-rating]')?.getAttribute('data-rating') ?? '0'
          );
          const ratingB = parseFloat(
            elB.querySelector('[data-rating]')?.getAttribute('data-rating') ?? '0'
          );
          return ratingB - ratingA; // Descending
        });
      };

      const sortByDate = () => {
        sort((itemA, itemB) => {
          const elA = itemA.getElement();
          const elB = itemB.getElement();
          const dateA = new Date(
            elA.querySelector('[data-date]')?.getAttribute('data-date') ?? ''
          ).getTime();
          const dateB = new Date(
            elB.querySelector('[data-date]')?.getAttribute('data-date') ?? ''
          ).getTime();
          return dateB - dateA; // Newest first
        });
      };

      const sortByPricePerRating = () => {
        sort((itemA, itemB) => {
          const elA = itemA.getElement();
          const elB = itemB.getElement();
          const priceA = parseFloat(
            elA.querySelector('[data-price]')?.getAttribute('data-price') ?? '0'
          );
          const ratingA = parseFloat(
            elA.querySelector('[data-rating]')?.getAttribute('data-rating') ?? '1'
          );
          const priceB = parseFloat(
            elB.querySelector('[data-price]')?.getAttribute('data-price') ?? '0'
          );
          const ratingB = parseFloat(
            elB.querySelector('[data-rating]')?.getAttribute('data-rating') ?? '1'
          );
          // Lower price per rating point is better
          return priceA / ratingA - priceB / ratingB;
        });
      };

      return (
        <div style={{ marginBottom: 16 }}>
          <p style={{ color: '#666', marginBottom: 8 }}>Sort with custom comparison logic:</p>
          <button type="button" style={buttonStyle} onClick={sortByRating}>
            By Rating (Best First)
          </button>
          <button type="button" style={buttonStyle} onClick={sortByDate}>
            By Date (Newest First)
          </button>
          <button type="button" style={buttonStyle} onClick={sortByPricePerRating}>
            Best Value (Price/Rating)
          </button>
        </div>
      );
    }

    return (
      <div style={containerStyle}>
        <MuuriGrid layoutDuration={300}>
          <CustomSortControls />
          {products.map((product) => (
            <MuuriItem key={product.id}>
              <ProductCard product={product} />
            </MuuriItem>
          ))}
        </MuuriGrid>
      </div>
    );
  },
};

/**
 * Draggable with sorting
 */
export const DraggableWithSorting: Story = {
  render: function DraggableWithSortingStory() {
    const [activeSort, setActiveSort] = useState('none');

    function DragSortControls() {
      const { sort } = useSort();

      const applySort = (sortKey: string) => {
        setActiveSort(sortKey);
        if (sortKey === 'none') {
          // Keep current order (manual drag order)
          return;
        }
        sort(`data-${sortKey}`);
      };

      return (
        <div style={{ marginBottom: 16 }}>
          <p style={{ color: '#666', marginBottom: 8 }}>
            Drag to reorder manually, or use buttons to sort automatically:
          </p>
          <button
            type="button"
            style={activeSort === 'none' ? activeButtonStyle : buttonStyle}
            onClick={() => applySort('none')}
          >
            Manual Order
          </button>
          <button
            type="button"
            style={activeSort === 'name' ? activeButtonStyle : buttonStyle}
            onClick={() => applySort('name')}
          >
            Sort by Name
          </button>
          <button
            type="button"
            style={activeSort === 'price' ? activeButtonStyle : buttonStyle}
            onClick={() => applySort('price')}
          >
            Sort by Price
          </button>
        </div>
      );
    }

    return (
      <div style={containerStyle}>
        <MuuriGrid dragEnabled dragSort layoutDuration={300}>
          <DragSortControls />
          {products.map((product) => (
            <MuuriItem key={product.id}>
              <div
                data-price={product.price}
                data-name={product.name}
                style={{
                  width: 140,
                  height: 120,
                  backgroundColor: '#9b59b6',
                  borderRadius: 8,
                  margin: 8,
                  padding: 12,
                  color: 'white',
                  cursor: 'grab',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                }}
              >
                <div style={{ fontWeight: 'bold', fontSize: 14 }}>{product.name}</div>
                <div style={{ fontSize: 12 }}>${product.price}</div>
              </div>
            </MuuriItem>
          ))}
        </MuuriGrid>
      </div>
    );
  },
};
