import { useAuth, useClerk, useUser } from '@clerk/react';
import { Link } from '@tanstack/react-router';
import { LogOut, LogIn, UserIcon } from 'lucide-react';
import { ProfilePicture } from '@/components/profile/profile-picture';
import { useOwnerProfile } from '@/hooks/use-owner-profile';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

function buildUrl(path: string): string {
  const basePath = import.meta.env.VITE_BASE_PATH || '';
  const full = `${basePath}${path.startsWith('/') ? '' : '/'}${path}`;
  return full.replace(/\/+/g, '/') || '/';
}

export function UserMenu() {
  const { isSignedIn, isLoaded, userId } = useAuth();
  const { user } = useUser();
  const { signOut } = useClerk();
  const { profile: owner } = useOwnerProfile(isSignedIn ? (userId ?? '') : '');

  if (!isLoaded) {
    return null;
  }

  if (!isSignedIn) {
    return (
      <Button asChild variant="ghost" size="sm">
        <Link to="/sign-in" data-testid="user-menu-sign-in-link">
          <LogIn className="mr-2 h-4 w-4" />
          Sign in
        </Link>
      </Button>
    );
  }

  if (!user) return null;
  const displayName =
    owner?.displayName || user.fullName || user.primaryEmailAddress?.emailAddress || 'Your Profile';
  const profile = owner ?? { id: userId ?? 'current-user', displayName, pictureAssetId: null };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button data-testid="user-menu-trigger" variant="ghost" size="sm" className="gap-2">
          <ProfilePicture
            profile={profile}
            className="flex size-6 shrink-0 items-center justify-center rounded-full object-cover text-xs font-medium text-white"
          />
          <span data-testid="user-menu-user-name" className="hidden sm:inline">
            {displayName}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <Link to="/settings/profile" aria-label="Profile settings">
            <UserIcon className="mr-2 h-4 w-4" />
            Profile settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => void signOut({ redirectUrl: buildUrl('/') })}>
          <LogOut className="mr-2 h-4 w-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
