import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useState } from 'react';
import { ProfilePicture } from '@/components/profile/profile-picture';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { searchProfiles } from '@/lib/graphql/profiles';

interface ProfileFilterProps {
  profileId?: string;
  onChange: (profileId?: string) => void;
}

export function ProfileFilter({ onChange }: ProfileFilterProps) {
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
  });

  return (
    <div className="flex max-w-lg flex-col gap-2">
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
