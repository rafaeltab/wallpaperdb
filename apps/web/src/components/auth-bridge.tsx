import { useAuth } from '@clerk/react';
import { createContext, useContext, useEffect, useState } from 'react';
import { clearTokenProvider, setTokenProvider } from '@/lib/auth/token-provider';

const AuthTokenReadyContext = createContext(false);

export function useAuthTokenReady() {
  return useContext(AuthTokenReadyContext);
}

export function AuthBridge({ children }: { children: React.ReactNode }) {
  const { getToken, isLoaded } = useAuth();
  const [readyProvider, setReadyProvider] = useState<typeof getToken | null>(null);

  useEffect(() => {
    if (isLoaded) {
      setTokenProvider(getToken);
      setReadyProvider(() => getToken);
    }
    return () => {
      clearTokenProvider();
    };
  }, [getToken, isLoaded]);

  const isTokenReady = isLoaded && readyProvider === getToken;

  return (
    <AuthTokenReadyContext.Provider value={isTokenReady}>
      {children}
    </AuthTokenReadyContext.Provider>
  );
}
