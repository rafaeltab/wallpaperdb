import { createContext, useContext, useEffect, useState } from 'react';

import { parseTheme, resolvedTheme, type Theme } from '@/features/preferences';

type ThemeProviderProps = {
  children: React.ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
};

type ThemeProviderState = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
};

const ThemeProviderContext = createContext<ThemeProviderState | undefined>(undefined);

export function ThemeProvider({
  children,
  defaultTheme = 'system',
  storageKey = 'wallpaperdb-theme',
}: ThemeProviderProps) {
  const [theme, setTheme] = useState<Theme>(() =>
    parseTheme(localStorage.getItem(storageKey), defaultTheme)
  );

  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove('light', 'dark');

    root.classList.add(
      resolvedTheme(theme, window.matchMedia('(prefers-color-scheme: dark)').matches)
    );
  }, [theme]);

  const value = {
    theme,
    setTheme: (theme: Theme) => {
      localStorage.setItem(storageKey, theme);
      setTheme(theme);
    },
  };

  return <ThemeProviderContext.Provider value={value}>{children}</ThemeProviderContext.Provider>;
}

export const useTheme = () => {
  const context = useContext(ThemeProviderContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};
