import { Loader2 } from 'lucide-react';
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
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Loading more...</span>
        </div>
      ) : (
        <div className="h-4" />
      )}
    </div>
  );
}
