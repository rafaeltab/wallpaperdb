import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { MuuriGrid } from '../src/MuuriGrid.js';
import { MuuriItem } from '../src/MuuriItem.js';
import { useFilter } from '../src/hooks/useFilter.js';
import { useItem } from '../src/hooks/useItem.js';

const meta: Meta = {
  title: 'Features/Filtering',
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
type Category = 'fruit' | 'vegetable' | 'grain';

interface FoodItem {
  id: number;
  name: string;
  category: Category;
  color: string;
}

const foods: FoodItem[] = [
  { id: 1, name: 'Apple', category: 'fruit', color: '#e74c3c' },
  { id: 2, name: 'Carrot', category: 'vegetable', color: '#e67e22' },
  { id: 3, name: 'Banana', category: 'fruit', color: '#f1c40f' },
  { id: 4, name: 'Broccoli', category: 'vegetable', color: '#27ae60' },
  { id: 5, name: 'Rice', category: 'grain', color: '#ecf0f1' },
  { id: 6, name: 'Orange', category: 'fruit', color: '#e67e22' },
  { id: 7, name: 'Spinach', category: 'vegetable', color: '#2ecc71' },
  { id: 8, name: 'Wheat', category: 'grain', color: '#d4ac6e' },
  { id: 9, name: 'Grape', category: 'fruit', color: '#9b59b6' },
];

/**
 * Food card component
 */
function FoodCard({ food }: { food: FoodItem }) {
  const { isVisible } = useItem();

  return (
    <div
      data-category={food.category}
      style={{
        width: 100,
        height: 100,
        backgroundColor: food.color,
        borderRadius: 8,
        margin: 8,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        color: food.color === '#ecf0f1' ? '#333' : 'white',
        fontWeight: 'bold',
        fontSize: 14,
        opacity: isVisible ? 1 : 0.3,
      }}
    >
      <div>{food.name}</div>
      <div style={{ fontSize: 10, marginTop: 4, opacity: 0.8 }}>{food.category}</div>
    </div>
  );
}

/**
 * Filter controls component
 */
function FilterControls({
  activeFilter,
  onFilterChange,
}: {
  activeFilter: string;
  onFilterChange: (filter: string) => void;
}) {
  const { filter } = useFilter();

  const applyFilter = (category: string) => {
    onFilterChange(category);
    if (category === 'all') {
      filter(() => true);
    } else {
      filter(`[data-category="${category}"]`);
    }
  };

  return (
    <div style={{ marginBottom: 16 }}>
      <button
        type="button"
        style={activeFilter === 'all' ? activeButtonStyle : buttonStyle}
        onClick={() => applyFilter('all')}
      >
        All
      </button>
      <button
        type="button"
        style={activeFilter === 'fruit' ? activeButtonStyle : buttonStyle}
        onClick={() => applyFilter('fruit')}
      >
        Fruits
      </button>
      <button
        type="button"
        style={activeFilter === 'vegetable' ? activeButtonStyle : buttonStyle}
        onClick={() => applyFilter('vegetable')}
      >
        Vegetables
      </button>
      <button
        type="button"
        style={activeFilter === 'grain' ? activeButtonStyle : buttonStyle}
        onClick={() => applyFilter('grain')}
      >
        Grains
      </button>
    </div>
  );
}

/**
 * Basic filtering with category buttons
 */
export const BasicFiltering: Story = {
  render: function BasicFilteringStory() {
    const [activeFilter, setActiveFilter] = useState('all');

    return (
      <div style={containerStyle}>
        <MuuriGrid layoutDuration={300} showDuration={300} hideDuration={300}>
          <FilterControls activeFilter={activeFilter} onFilterChange={setActiveFilter} />
          {foods.map((food) => (
            <MuuriItem key={food.id}>
              <FoodCard food={food} />
            </MuuriItem>
          ))}
        </MuuriGrid>
      </div>
    );
  },
};

/**
 * Search filter with text input
 */
export const SearchFilter: Story = {
  render: function SearchFilterStory() {
    const [searchTerm, setSearchTerm] = useState('');

    function SearchControls() {
      const { filter } = useFilter();

      const handleSearch = (term: string) => {
        setSearchTerm(term);
        if (term === '') {
          filter(() => true);
        } else {
          filter((item) => {
            const el = item.getElement();
            const text = el.textContent?.toLowerCase() ?? '';
            return text.includes(term.toLowerCase());
          });
        }
      };

      return (
        <div style={{ marginBottom: 16 }}>
          <input
            type="text"
            placeholder="Search foods..."
            value={searchTerm}
            onChange={(e) => handleSearch(e.target.value)}
            style={{
              padding: '8px 16px',
              borderRadius: 4,
              border: '1px solid #ddd',
              width: 300,
              fontSize: 14,
            }}
          />
        </div>
      );
    }

    return (
      <div style={containerStyle}>
        <MuuriGrid layoutDuration={300} showDuration={300} hideDuration={300}>
          <SearchControls />
          {foods.map((food) => (
            <MuuriItem key={food.id}>
              <FoodCard food={food} />
            </MuuriItem>
          ))}
        </MuuriGrid>
      </div>
    );
  },
};

/**
 * Multi-select filter with checkboxes
 */
export const MultiSelectFilter: Story = {
  render: function MultiSelectFilterStory() {
    const [selectedCategories, setSelectedCategories] = useState<Set<Category>>(
      new Set(['fruit', 'vegetable', 'grain'])
    );

    function MultiFilterControls() {
      const { filter } = useFilter();

      const toggleCategory = (category: Category) => {
        const newSelected = new Set(selectedCategories);
        if (newSelected.has(category)) {
          newSelected.delete(category);
        } else {
          newSelected.add(category);
        }
        setSelectedCategories(newSelected);

        if (newSelected.size === 0) {
          filter(() => false);
        } else {
          filter((item) => {
            const el = item.getElement();
            const cat = el
              .querySelector('[data-category]')
              ?.getAttribute('data-category') as Category;
            return newSelected.has(cat);
          });
        }
      };

      return (
        <div style={{ marginBottom: 16 }}>
          <label style={{ marginRight: 16, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={selectedCategories.has('fruit')}
              onChange={() => toggleCategory('fruit')}
              style={{ marginRight: 4 }}
            />
            Fruits
          </label>
          <label style={{ marginRight: 16, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={selectedCategories.has('vegetable')}
              onChange={() => toggleCategory('vegetable')}
              style={{ marginRight: 4 }}
            />
            Vegetables
          </label>
          <label style={{ cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={selectedCategories.has('grain')}
              onChange={() => toggleCategory('grain')}
              style={{ marginRight: 4 }}
            />
            Grains
          </label>
        </div>
      );
    }

    return (
      <div style={containerStyle}>
        <MuuriGrid layoutDuration={300} showDuration={300} hideDuration={300}>
          <MultiFilterControls />
          {foods.map((food) => (
            <MuuriItem key={food.id}>
              <FoodCard food={food} />
            </MuuriItem>
          ))}
        </MuuriGrid>
      </div>
    );
  },
};

/**
 * Filter with instant animation (no transition)
 */
export const InstantFilter: Story = {
  render: function InstantFilterStory() {
    const [activeFilter, setActiveFilter] = useState('all');

    function InstantFilterControls() {
      const { filter } = useFilter();

      const applyFilter = (category: string) => {
        setActiveFilter(category);
        if (category === 'all') {
          filter(() => true, { instant: true });
        } else {
          filter(`[data-category="${category}"]`, { instant: true });
        }
      };

      return (
        <div style={{ marginBottom: 16 }}>
          <p style={{ color: '#666', marginBottom: 8 }}>Instant filter (no animation):</p>
          <button
            type="button"
            style={activeFilter === 'all' ? activeButtonStyle : buttonStyle}
            onClick={() => applyFilter('all')}
          >
            All
          </button>
          <button
            type="button"
            style={activeFilter === 'fruit' ? activeButtonStyle : buttonStyle}
            onClick={() => applyFilter('fruit')}
          >
            Fruits
          </button>
          <button
            type="button"
            style={activeFilter === 'vegetable' ? activeButtonStyle : buttonStyle}
            onClick={() => applyFilter('vegetable')}
          >
            Vegetables
          </button>
        </div>
      );
    }

    return (
      <div style={containerStyle}>
        <MuuriGrid layoutDuration={300} showDuration={300} hideDuration={300}>
          <InstantFilterControls />
          {foods.map((food) => (
            <MuuriItem key={food.id}>
              <FoodCard food={food} />
            </MuuriItem>
          ))}
        </MuuriGrid>
      </div>
    );
  },
};
