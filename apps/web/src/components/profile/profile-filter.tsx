import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useState } from 'react';
import { ProfilePicture } from '@/components/profile/profile-picture';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { searchProfiles } from '@/lib/graphql/profiles';
import { profileByIdQueryOptions } from '@/lib/profile-query-options';

interface ProfileFilterProps {
  profileId?: string;
  onChange: (profileId?: string) => void;
}

export function ProfileFilter({ profileId, onChange }: ProfileFilterProps) {
  const inputId = useId();
  const [input, setInput] = useState('');
  const query = input.trim().toLowerCase();
  const [debouncedQuery, setDebouncedQuery] = useState('');
  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedQuery(query), 250);
    return () => window.clearTimeout(timeout);
  }, [query]);
  const results = useQuery({
    queryKey: ['profile-search', debouncedQuery],
    queryFn: () => searchProfiles(debouncedQuery),
    enabled: Boolean(debouncedQuery),
    retry: false,
  });
  const selected = useQuery({
    ...profileByIdQueryOptions(profileId ?? ''),
    enabled: Boolean(profileId),
  });

  return (
    <div className="flex max-w-lg flex-col gap-2">
      {profileId ? (
        <div className="flex items-center gap-3 rounded-lg border bg-background p-3">
          {selected.data ? (
            <>
              <ProfilePicture profile={selected.data} className="flex size-10 shrink-0 items-center justify-center rounded-full object-cover text-sm font-semibold text-white" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{selected.data.displayName}</span>
                <span className="block truncate text-xs text-muted-foreground">@{selected.data.handle}</span>
              </span>
            </>
          ) : <span className="flex-1 text-sm text-muted-foreground">Loading selected Profile…</span>}
          <Button type="button" variant="outline" size="sm" aria-label="Clear Profile filter" onClick={() => {
            setInput('');
            onChange(undefined);
          }}>Clear</Button>
        </div>
      ) : null}
      <div>
        <label htmlFor={inputId} className="text-sm font-medium">Profile</label>
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
        <p role="status" className="text-xs text-muted-foreground">Searching Profiles…</p>
      ) : null}
      {query && query === debouncedQuery && results.isError ? (
        <div className="flex flex-wrap items-center gap-2">
          <p role="alert" className="text-xs text-destructive">Could not search Profiles. Try again.</p>
          <Button type="button" variant="outline" size="sm" onClick={() => void results.refetch()} aria-label="Retry Profile search">Try again</Button>
        </div>
      ) : null}
      {query && query === debouncedQuery && results.data?.edges.length === 0 ? (
        <p role="status" className="text-xs text-muted-foreground">No Profiles found. Try another Handle or Display name.</p>
      ) : null}
      {query && query === debouncedQuery && results.data ? (
        <ul aria-label="Matching Profiles" className="max-h-64 overflow-y-auto rounded-lg border bg-background p-1">
          {results.data.edges.map(({ node: profile }) => (
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
                <ProfilePicture profile={profile} className="flex size-10 shrink-0 items-center justify-center rounded-full object-cover text-sm font-semibold text-white" />
                <span className="min-w-0">
                  <span className="block truncate font-medium">{profile.displayName}</span>
                  <span className="block truncate text-xs text-muted-foreground">@{profile.handle}</span>
                </span>
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
