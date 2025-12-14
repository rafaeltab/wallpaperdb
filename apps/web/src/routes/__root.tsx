import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, Link, Outlet } from '@tanstack/react-router';
import { TanStackRouterDevtools } from '@tanstack/router-devtools';
import { Image } from 'lucide-react';
import { AppSidebar } from '@/components/app-sidebar';
import { SearchBar } from '@/components/search-bar';
import { ThemeToggle } from '@/components/theme-toggle';
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar';

interface RouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
});

function RootLayout() {
  return (
    <SidebarProvider defaultOpen={false}>
      <AppSidebar />
      <SidebarInset>
        <div className="min-h-screen bg-background">
          <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <div className="max-w-7xl mx-auto px-4 py-3">
              <div className="flex items-center gap-4">
                {/* Sidebar Trigger */}
                <SidebarTrigger className="-ml-1" />

                {/* Logo */}
                <Link to="/" className="flex items-center gap-2 shrink-0">
                  <Image className="h-6 w-6 text-primary" />
                  <span className="text-xl font-bold text-foreground hidden sm:inline">
                    WallpaperDB
                  </span>
                </Link>

                {/* Search Bar - grows to fill space */}
                <div className="flex-1 flex justify-center max-w-xl mx-auto">
                  <SearchBar />
                </div>

                {/* Theme Toggle */}
                <ThemeToggle />
              </div>
            </div>
          </header>
          <main className="pb-8">
            <Outlet />
          </main>
        </div>
      </SidebarInset>
      <TanStackRouterDevtools position="bottom-right" />
    </SidebarProvider>
  );
}
