import {cleanup,render,screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,expect,it} from 'vitest';
import {ThemeProvider} from '@/components/theme-provider';
import {ThemeToggle} from '@/components/theme-toggle';
afterEach(()=>{cleanup();localStorage.removeItem('theme-toggle-test');});
it('sets and persists each selected appearance through the real toggle',async()=>{
 const user=userEvent.setup();
 render(<ThemeProvider storageKey="theme-toggle-test"><ThemeToggle /></ThemeProvider>);
 await user.click(screen.getByRole('radio',{name:'Dark mode'}));
 expect(localStorage.getItem('theme-toggle-test')).toBe('dark');
 expect(document.documentElement).toHaveClass('dark');
 await user.click(screen.getByRole('radio',{name:'Light mode'}));
 expect(localStorage.getItem('theme-toggle-test')).toBe('light');
 expect(document.documentElement).toHaveClass('light');
});

it('falls back to the configured appearance for an invalid saved preference',()=>{
 localStorage.setItem('theme-toggle-test','unsupported');
 render(<ThemeProvider storageKey="theme-toggle-test" defaultTheme="dark"><ThemeToggle /></ThemeProvider>);
 expect(document.documentElement).toHaveClass('dark');
 expect(screen.getByRole('radio',{name:'Dark mode'})).toHaveAttribute('aria-checked','true');
});
