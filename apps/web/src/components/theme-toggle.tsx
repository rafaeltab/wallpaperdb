import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from '@/components/theme-provider';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  return (
    <ToggleGroup
      type="single"
      value={theme}
      onValueChange={(value) => {
        if (value) setTheme(value as 'light' | 'dark' | 'system');
      }}
      className="bg-muted rounded-md p-0.5"
    >
      <ToggleGroupItem
        value="light"
        aria-label="Light mode"
        className="h-7 w-7 data-[state=on]:bg-background data-[state=on]:shadow-sm"
      >
        <Sun className="h-4 w-4" />
      </ToggleGroupItem>
      <ToggleGroupItem
        value="dark"
        aria-label="Dark mode"
        className="h-7 w-7 data-[state=on]:bg-background data-[state=on]:shadow-sm"
      >
        <Moon className="h-4 w-4" />
      </ToggleGroupItem>
      <ToggleGroupItem
        value="system"
        aria-label="System theme"
        className="h-7 w-7 data-[state=on]:bg-background data-[state=on]:shadow-sm"
      >
        <Monitor className="h-4 w-4" />
      </ToggleGroupItem>
    </ToggleGroup>
  );
}
