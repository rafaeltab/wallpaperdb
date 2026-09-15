import { createFileRoute } from '@tanstack/react-router';
import { ProfileSettingsPage } from '@/components/profile/profile-settings-page';

export const Route = createFileRoute('/settings/profile')({
  validateSearch: (search: Record<string, unknown>): { variant?: 'A' | 'B' | 'C' } => ({
    variant:
      import.meta.env.DEV && ['A', 'B', 'C'].includes(String(search.variant))
        ? (search.variant as 'A' | 'B' | 'C')
        : undefined,
  }),
  component: ProfileSettingsPage,
});
