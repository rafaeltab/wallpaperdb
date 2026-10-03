import { useNavigate } from '@tanstack/react-router';
import { useCallback, useState } from 'react';
import { buildAuthUrl, postAuthDestination } from '../index';

export function useAuthNavigation() {
  const navigate = useNavigate();
  const [redirectUrl] = useState(
    () => new URLSearchParams(window.location.search).get('redirect') || '/'
  );
  const finalizeNavigation = useCallback(
    async ({
      session,
      decorateUrl,
    }: {
      session?: { currentTask?: unknown } | null;
      decorateUrl: (url: string) => string;
    }) => {
      const destination = postAuthDestination(
        session?.currentTask ? redirectUrl : decorateUrl(redirectUrl),
        Boolean(session?.currentTask)
      );
      if (destination.kind === 'document') window.location.href = destination.url;
      else if (destination.kind === 'route') void navigate({ to: destination.url });
    },
    [navigate, redirectUrl]
  );
  return {
    oauthUrls: {
      redirectUrl: buildAuthUrl(import.meta.env.VITE_BASE_PATH || '', redirectUrl),
      redirectCallbackUrl: buildAuthUrl(import.meta.env.VITE_BASE_PATH || '', '/sso-callback'),
    },
    finalizeNavigation,
  };
}
