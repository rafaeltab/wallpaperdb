import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type MouseEventHandler,
  type ReactNode,
} from 'react';

interface BrowseFilterPanelState {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  toggle: () => void;
  homeNavigationVersion: number;
  onBrowseLinkClick: MouseEventHandler<HTMLAnchorElement>;
}

const BrowseFilterPanelContext = createContext<BrowseFilterPanelState | null>(null);

export function BrowseFilterPanelProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [homeNavigationVersion, setHomeNavigationVersion] = useState(0);
  const onBrowseLinkClick = useCallback<MouseEventHandler<HTMLAnchorElement>>((event) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    setHomeNavigationVersion((version) => version + 1);
  }, []);

  const value = useMemo(
    () => ({
      isOpen,
      setIsOpen,
      toggle: () => setIsOpen((current) => !current),
      homeNavigationVersion,
      onBrowseLinkClick,
    }),
    [homeNavigationVersion, isOpen, onBrowseLinkClick]
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
