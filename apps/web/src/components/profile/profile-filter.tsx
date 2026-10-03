import { feedPresentation } from '@/features/browse';
import { normalizeProfileSearch } from '@/features/browse';
import { GraphQLError } from '@/components/graphql-error';
import { graphqlQueryOptions } from '@/features/request-admission/adapters/graphql';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useEffect, useId, useState } from 'react';
import { ProfilePicture } from '@/components/profile/profile-picture';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { searchProfiles } from '@/lib/graphql/profiles';
import { profileByIdQueryOptions } from '@/lib/profile-query-options';

interface ProfileFilterProps {
  profileId?: string;
  onChange: (profileId?: string) => void;
  collapsed?: boolean;
}

function SelectedProfile({ profileId, onClear }: { profileId: string; onClear: () => void }) {
  const selected = useQuery(profileByIdQueryOptions(profileId));

  const selectedError = selected.failureReason ?? selected.error;
  return (
    <>
      <div className="flex items-center gap-3 rounded-lg border bg-background p-3">
        {selected.data ? (
          <>
            <ProfilePicture
              profile={selected.data}
              className="flex size-10 shrink-0 items-center justify-center rounded-full object-cover text-sm font-semibold text-white"
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">
                {selected.data.displayName}
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                @{selected.data.handle}
              </span>
            </span>
          </>
        ) : selectedError ? null : (
          <span className="flex-1 text-sm text-muted-foreground">
            {selected.isLoading ? 'Loading selected Profile…' : 'Selected Profile is unavailable.'}
          </span>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label="Clear Profile filter"
          onClick={onClear}
        >
          Clear
        </Button>
      </div>
      {selectedError ? (
        <GraphQLError
          error={selectedError}
          retry={() => selected.refetch()}
          retrying={selected.isFetching}
          title="Could not load the selected Profile."
          retryLabel="Retry selected Profile"
        />
      ) : null}
    </>
  );
}

export function ProfileFilter({ profileId, onChange, collapsed = false }: ProfileFilterProps) {
  const inputId = useId();
  const [input, setInput] = useState('');
  const query = normalizeProfileSearch(input);
  const [debouncedQuery, setDebouncedQuery] = useState('');
  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedQuery(query), 250);
    return () => window.clearTimeout(timeout);
  }, [query]);
  const results = useInfiniteQuery({
    ...graphqlQueryOptions,
    queryKey: ['profile-search', debouncedQuery],
    queryFn: ({ pageParam }) => searchProfiles(debouncedQuery, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => (page.pageInfo.hasNextPage ? page.pageInfo.endCursor : undefined),
    enabled: Boolean(debouncedQuery),
  });
  const feed = feedPresentation({
    ...results,
    itemCount: results.data?.pages.reduce((count, page) => count + page.edges.length, 0) ?? 0,
  });
  const resultsError = feed.error;
  const nextPageFailed = feed.retryTarget === 'next-page';

  return (
    <div className="flex max-w-lg flex-col gap-2">
      {profileId ? (
        <SelectedProfile
          profileId={profileId}
          onClear={() => {
            setInput('');
            onChange(undefined);
          }}
        />
      ) : null}
      {!collapsed ? (
        <>
          <div>
            <label htmlFor={inputId} className="text-sm font-medium">
              Profile
            </label>
            <p id={`${inputId}-hint`} className="text-xs text-muted-foreground">
              Find a contributor by Handle or Display name.
            </p>
          </div>
          <Input
            id={inputId}
            type="search"
            value={input}
            maxLength={100}
            placeholder="Search Profiles…"
            aria-describedby={`${inputId}-hint`}
            onChange={(event) => setInput(event.target.value)}
          />
          {query && (query !== debouncedQuery || results.isLoading) ? (
            <output htmlFor={inputId} className="text-xs text-muted-foreground">
              Searching Profiles…
            </output>
          ) : null}
          {query && query === debouncedQuery && results.data?.pages[0].edges.length === 0 ? (
            <output htmlFor={inputId} className="text-xs text-muted-foreground">
              No Profiles found. Try another Handle or Display name.
            </output>
          ) : null}
          {query && query === debouncedQuery && results.data ? (
            <ul
              aria-label="Matching Profiles"
              className="max-h-64 overflow-y-auto rounded-lg border bg-background p-1"
            >
              {results.data.pages
                .flatMap((page) => page.edges)
                .map(({ node: profile }) => (
                  <li key={profile.id}>
                    <Button
                      type="button"
                      variant="ghost"
                      aria-label={`Select ${profile.displayName} (@${profile.handle})`}
                      className="h-auto w-full justify-start gap-3 px-2 py-3 text-left"
                      onClick={() => {
                        onChange(profile.id);
                        setInput('');
                      }}
                    >
                      <ProfilePicture
                        profile={profile}
                        className="flex size-10 shrink-0 items-center justify-center rounded-full object-cover text-sm font-semibold text-white"
                      />
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{profile.displayName}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          @{profile.handle}
                        </span>
                      </span>
                    </Button>
                  </li>
                ))}
            </ul>
          ) : null}
          {query && query === debouncedQuery && resultsError ? (
            <GraphQLError
              error={resultsError}
              retry={() => (nextPageFailed ? results.fetchNextPage() : results.refetch())}
              retrying={results.isFetching}
              title={
                nextPageFailed
                  ? 'Could not load more Profiles.'
                  : 'Could not search Profiles. Try again.'
              }
              retryLabel={nextPageFailed ? 'Retry loading more Profiles' : 'Retry Profile search'}
            />
          ) : null}
          {query && query === debouncedQuery && results.hasNextPage && !resultsError ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={results.isFetchingNextPage}
              onClick={() => void results.fetchNextPage()}
            >
              {results.isFetchingNextPage
                ? 'Loading more Profiles…'
                : results.isFetchNextPageError
                  ? 'Retry loading more Profiles'
                  : 'Load more Profiles'}
            </Button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
