import { createFileRoute } from '@tanstack/react-router';
import { ProfileSettingsPage } from '@/components/profile/profile-settings-page';

export const Route = createFileRoute('/settings/profile')({
  validateSearch: (search: Record<string, unknown>): { variant?: 'A' | 'B' | 'C' | 'D' | 'E' } => ({
    variant:
      import.meta.env.DEV &&
      (search.variant === 'A' ||
        search.variant === 'B' ||
        search.variant === 'C' ||
        search.variant === 'D' ||
        search.variant === 'E')
        ? search.variant
        : undefined,
  }),
  component: ProfileSettingsRoute,
});

function ProfileSettingsRoute() {
  const { variant } = Route.useSearch();
  return <ProfileSettingsPage variant={variant} />;
}
