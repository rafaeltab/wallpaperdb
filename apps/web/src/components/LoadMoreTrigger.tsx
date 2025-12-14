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

  // Invisible trigger element - skeletons are rendered in the grid itself
  return <div ref={ref} className="h-4" />;
}
