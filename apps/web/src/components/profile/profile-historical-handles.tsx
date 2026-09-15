import { Button } from '@/components/ui/button';
import type { HistoricalHandle, Profile } from '@/lib/api/user';

export function historicalHandleUnavailableMessage(history: HistoricalHandle): string | null {
  if (Date.parse(history.eligibleUntil) <= Date.now()) {
    return 'This Handle is no longer in your 30-day history. Refresh aliases.';
  }
  if (history.unavailableReason === 'claimed') return 'Another Profile has claimed this Handle.';
  if (history.unavailableReason === 'alias-limit') {
    return 'Your retained-alias limit is full. Schedule an alias for removal to free a slot.';
  }
  return null;
}

export function ProfileHistoricalHandles({
  profile,
  disabled,
  onReactivate,
}: {
  profile: Profile;
  disabled: boolean;
  onReactivate: (handle: string) => void;
}) {
  const history = (profile.historicalHandles ?? []).filter(
    (entry) => !profile.aliases?.some((alias) => alias.handle === entry.handle)
  );

  return (
    <section aria-labelledby="historical-handles-heading">
      <h2 id="historical-handles-heading" className="font-medium">
        Historical Handles
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Reactivate a Handle from your last 30 days of history as a retained alias.
      </p>
      {history.length ? (
        <ul aria-labelledby="historical-handles-heading" className="mt-3 divide-y">
          {history.map((entry) => {
            const unavailable = historicalHandleUnavailableMessage(entry);
            return (
              <li
                key={entry.handle}
                className="flex flex-wrap items-center justify-between gap-3 py-3"
              >
                <div>
                  <p className="break-all font-medium">@{entry.handle}</p>
                  <p className="text-sm text-muted-foreground">
                    History available until{' '}
                    <time dateTime={entry.eligibleUntil} title={entry.eligibleUntil}>
                      {new Date(entry.eligibleUntil).toLocaleString()}
                    </time>
                  </p>
                  {unavailable && (
                    <p
                      id={`history-${entry.handle}-unavailable`}
                      className="mt-1 text-sm text-muted-foreground"
                    >
                      {unavailable}
                    </p>
                  )}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  aria-label={`Reactivate @${entry.handle}`}
                  aria-describedby={unavailable ? `history-${entry.handle}-unavailable` : undefined}
                  disabled={disabled || Boolean(unavailable)}
                  onClick={() => onReactivate(entry.handle)}
                >
                  Reactivate
                </Button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">No recent historical Handles.</p>
      )}
    </section>
  );
}
