import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, Link, Outlet, useRouterState } from '@tanstack/react-router';
import { TanStackRouterDevtools } from '@tanstack/router-devtools';
import { Image, PanelRight, X } from 'lucide-react';
import { AppSidebar } from '@/components/app-sidebar';
import { SearchBar } from '@/components/search-bar';
import { Button } from '@/components/ui/button';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';

interface RouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
});

function RootLayout() {
  const routerState = useRouterState();

  // Check if we're on the wallpaper details page
  const isWallpaperDetailsPage = routerState.location.pathname.startsWith('/wallpapers/');

  const handleClose = () => {
    // Close the current tab/window
    window.close();
  };

  return (
    <div className="[--header-height:3.5rem]">
      <SidebarProvider defaultOpen={false} className="flex flex-col">
        {/* Header is OUTSIDE the sidebar/content flex */}
        <header className="sticky top-0 z-50 flex h-(--header-height) w-full items-center border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <div className="flex w-full items-center gap-4 px-4">
            {/* Left side - consistent across all pages */}
            <div className="flex items-center gap-4 shrink-0">
              <SidebarTrigger className="-ml-1" />
              <Link to="/" className="flex items-center gap-2 shrink-0">
                <Image className="h-6 w-6 text-primary" />
                <span className="text-xl font-bold text-foreground hidden sm:inline">
                  WallpaperDB
                </span>
              </Link>
            </div>
            {/* Center - Search bar (absolutely centered) */}
            <div className="absolute left-1/2 -translate-x-1/2 w-full max-w-xl px-4">
              <SearchBar />
            </div>
            {/* Right side - close button and panel toggle on details page */}
            <div className="flex-1" />
            <div className="flex items-center gap-2">
              {isWallpaperDetailsPage && (
                <>
                  <div id="wallpaper-details-header-actions" />
                  <Button variant="ghost" size="sm" onClick={handleClose} aria-label="Close">
                    <X className="h-4 w-4" />
                  </Button>
                </>
              )}
            </div>
          </div>
        </header>
        {/* Sidebar and content in flex row */}
        <div className="flex flex-1">
          <AppSidebar />
          <SidebarInset>
            <main className={isWallpaperDetailsPage ? '' : 'pb-8'}>
              <Outlet />
            </main>
          </SidebarInset>
        </div>
        <TanStackRouterDevtools position="bottom-right" />
      </SidebarProvider>
    </div>
  );
}
