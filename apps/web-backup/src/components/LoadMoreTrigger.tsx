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

  return (
    <div ref={ref} className="flex justify-center py-8">
      {isLoading ? (
        <div className="text-gray-600">Loading more...</div>
      ) : (
        <div className="h-4" />
      )}
    </div>
  );
}
