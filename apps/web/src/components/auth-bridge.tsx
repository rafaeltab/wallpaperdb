import { useAuth } from '@clerk/react';
import { useEffect } from 'react';
import { clearTokenProvider, setTokenProvider } from '@/lib/auth/token-provider';

export function AuthBridge({ children }: { children: React.ReactNode }) {
  const { getToken, isLoaded } = useAuth();

  useEffect(() => {
    if (isLoaded) {
      setTokenProvider(getToken);
    }
    return () => {
      clearTokenProvider();
    };
  }, [getToken, isLoaded]);

  return <>{children}</>;
}
