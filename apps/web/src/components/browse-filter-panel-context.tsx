import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

interface BrowseFilterPanelState {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  toggle: () => void;
}

const BrowseFilterPanelContext = createContext<BrowseFilterPanelState | null>(null);

export function BrowseFilterPanelProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);

  const value = useMemo(
    () => ({
      isOpen,
      setIsOpen,
      toggle: () => setIsOpen((current) => !current),
    }),
    [isOpen]
  );

  return (
    <BrowseFilterPanelContext.Provider value={value}>{children}</BrowseFilterPanelContext.Provider>
  );
}

export function useBrowseFilterPanel() {
  const context = useContext(BrowseFilterPanelContext);

  if (!context) {
    throw new Error('useBrowseFilterPanel must be used within BrowseFilterPanelProvider');
  }

  return context;
}
