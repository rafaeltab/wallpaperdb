import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, Link, Outlet } from '@tanstack/react-router';
import { TanStackRouterDevtools } from '@tanstack/router-devtools';
import { Image, Menu, Upload } from 'lucide-react';
import { SearchBar } from '@/components/search-bar';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';

interface RouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
});

function RootLayout() {
  return (
    <div className="min-h-screen bg-background">
      <nav className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="max-w-7xl mx-auto px-4 py-3">
          {/* Desktop Navigation - 3 column grid */}
          <div className="hidden md:grid md:grid-cols-[1fr_minmax(300px,500px)_1fr] items-center gap-4">
            {/* Left - Logo and Nav Links */}
            <div className="flex items-center gap-6">
              <Link to="/" className="flex items-center gap-2 shrink-0">
                <Image className="h-6 w-6 text-primary" />
                <span className="text-xl font-bold text-foreground">WallpaperDB</span>
              </Link>
              <div className="flex items-center gap-1">
                <Link
                  to="/"
                  className="px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors rounded-md hover:bg-accent"
                  activeProps={{ className: 'text-foreground bg-accent' }}
                >
                  Browse
                </Link>
                <Link
                  to="/upload"
                  className="px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors rounded-md hover:bg-accent"
                  activeProps={{ className: 'text-foreground bg-accent' }}
                >
                  Upload
                </Link>
              </div>
            </div>

            {/* Center - Search Bar */}
            <div className="flex justify-center">
              <SearchBar />
            </div>

            {/* Right - Theme Toggle */}
            <div className="flex items-center justify-end">
              <ThemeToggle />
            </div>
          </div>

          {/* Mobile Navigation */}
          <div className="flex md:hidden items-center justify-between">
            <Link to="/" className="flex items-center gap-2">
              <Image className="h-6 w-6 text-primary" />
              <span className="text-xl font-bold text-foreground">WallpaperDB</span>
            </Link>
            <div className="flex items-center gap-2">
              <ThemeToggle />
              <MobileNav />
            </div>
          </div>
        </div>
      </nav>
      <main className="pb-8">
        <Outlet />
      </main>
      <TanStackRouterDevtools position="bottom-right" />
    </div>
  );
}

function MobileNav() {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon">
          <Menu className="h-5 w-5" />
          <span className="sr-only">Toggle menu</span>
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-[300px] sm:w-[400px]">
        <SheetTitle className="sr-only">Navigation Menu</SheetTitle>
        <nav className="flex flex-col gap-4 mt-8">
          <Link
            to="/"
            className="flex items-center gap-2 text-lg font-medium text-foreground hover:text-primary transition-colors"
          >
            <Image className="h-5 w-5" />
            Browse
          </Link>
          <Link
            to="/upload"
            className="flex items-center gap-2 text-lg font-medium text-foreground hover:text-primary transition-colors"
          >
            <Upload className="h-5 w-5" />
            Upload
          </Link>
        </nav>
      </SheetContent>
    </Sheet>
  );
}
