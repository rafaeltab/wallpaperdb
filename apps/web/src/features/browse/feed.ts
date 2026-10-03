export function feedPresentation<Error>(query: {
  error: Error | null;
  failureReason: Error | null;
  itemCount: number;
  isLoading: boolean;
  isFetchNextPageError: boolean;
  isFetchingNextPage: boolean;
}) {
  const error = query.failureReason ?? query.error;
  return {
    error,
    initialError: Boolean(error && query.itemCount === 0),
    showResults: query.itemCount > 0 || query.isLoading,
    retryTarget:
      query.isFetchNextPageError || query.isFetchingNextPage
        ? ('next-page' as const)
        : ('refresh' as const),
  };
}
