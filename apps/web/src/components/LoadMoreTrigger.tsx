import { useEffect } from 'react';
import { useIntersectionObserver } from '@/hooks/useIntersectionObserver';

interface LoadMoreTriggerProps {
  onLoadMore: () => void;
  hasMore: boolean;
  isLoading: boolean;
}

export function LoadMoreTrigger({ onLoadMore, hasMore, isLoading }: LoadMoreTriggerProps) {
  const { ref, isIntersecting } = useIntersectionObserver({
    enabled: hasMore && !isLoading,
    rootMargin: '200px',
  });

  useEffect(() => {
    if (isIntersecting && hasMore && !isLoading) {
      onLoadMore();
    }
  }, [isIntersecting, hasMore, isLoading, onLoadMore]);

  if (!hasMore) return null;

  // The gallery displays its loading status above this trigger.
  return <div ref={ref} className="h-4" />;
}
