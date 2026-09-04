import { createFileRoute } from '@tanstack/react-router';
import { ProfileSettingsPage } from '@/components/profile/profile-settings-page';

export const Route = createFileRoute('/settings/profile')({
  component: ProfileSettingsPage,
});
