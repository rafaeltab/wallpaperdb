import { useEffect, useState } from 'react';
import { formatTimeRemaining } from '@/lib/utils/upload-queue';

export function useCountdown(pausedUntil: number | null): string | null {
  const [timeRemaining, setTimeRemaining] = useState<string | null>(null);

  useEffect(() => {
    if (!pausedUntil) {
      setTimeRemaining(null);
      return;
    }

    const updateRemaining = () => {
      const remaining = pausedUntil - Date.now();
      if (remaining <= 0) {
        setTimeRemaining(null);
      } else {
        setTimeRemaining(formatTimeRemaining(remaining));
      }
    };

    updateRemaining();
    const interval = setInterval(updateRemaining, 1000);

    return () => clearInterval(interval);
  }, [pausedUntil]);

  return timeRemaining;
}
