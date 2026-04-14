import { useAuth, useClerk, useUser } from '@clerk/clerk-react';
import { Link } from '@tanstack/react-router';
import { LogOut, LogIn } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export function UserMenu() {
  const { isSignedIn, isLoaded } = useAuth();
  const { user } = useUser();
  const { signOut } = useClerk();

  if (!isLoaded) {
    return null;
  }

  if (!isSignedIn) {
    return (
      <Button asChild variant="ghost" size="sm">
        <Link to="/sign-in">
          <LogIn className="mr-2 h-4 w-4" />
          Sign in
        </Link>
      </Button>
    );
  }

  if (!user) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-2">
          <img src={user.imageUrl} alt="" className="h-6 w-6 rounded-full" aria-hidden="true" />
          <span className="hidden sm:inline">
            {user.fullName || user.primaryEmailAddress?.emailAddress}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onClick={() => {
            const basePath = import.meta.env.VITE_BASE_PATH || '';
            const homeUrl = `${basePath}/`.replace(/\/+/g, '/');
            void signOut({ redirectUrl: homeUrl });
          }}
        >
          <LogOut className="mr-2 h-4 w-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
