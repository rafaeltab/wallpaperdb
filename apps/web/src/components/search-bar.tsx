import { Search, SlidersHorizontal } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Kbd } from '@/components/ui/kbd';

function useIsMac() {
  const [isMac, setIsMac] = useState(false);

  useEffect(() => {
    setIsMac(navigator.platform.toUpperCase().includes('MAC'));
  }, []);

  return isMac;
}

interface SearchBarProps {
  showFilterToggle?: boolean;
  isFilterPanelOpen?: boolean;
  onToggleFilters?: () => void;
}

export function SearchBar({
  showFilterToggle = false,
  isFilterPanelOpen = false,
  onToggleFilters,
}: SearchBarProps = {}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const isMac = useIsMac();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Check for Ctrl+K or Cmd+K (Mac)
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <InputGroup className="bg-muted/50 border-transparent hover:bg-muted focus-within:bg-background focus-within:border-input">
      <InputGroupAddon>
        <Search />
      </InputGroupAddon>
      <InputGroupInput ref={inputRef} type="search" placeholder="Search wallpapers..." />
      <InputGroupAddon align="inline-end" className="hidden sm:flex">
        {showFilterToggle && onToggleFilters ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="Toggle filters"
            aria-pressed={isFilterPanelOpen}
            onClick={onToggleFilters}
            className="h-7 px-2"
          >
            <SlidersHorizontal className="h-4 w-4" />
            <span className="hidden md:inline">Filters</span>
          </Button>
        ) : null}
        {isMac ? <Kbd>⌘</Kbd> : <Kbd>Ctrl</Kbd>}
        <Kbd>K</Kbd>
      </InputGroupAddon>
    </InputGroup>
  );
}
