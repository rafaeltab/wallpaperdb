import { useEffect, useId, useRef, useState } from 'react';
import { activityView, activityDuration, activityAge, type ActivityFacts } from './activity-model';
import './activity.css';
export function FactoryActivity({
  facts,
  paused,
  refresh,
}: {
  facts?: ActivityFacts;
  paused: boolean;
  refresh?: { failures: number; lastSuccess: number | null };
}) {
  const [now, setNow] = useState(Date.now);
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const anchor = useRef<HTMLFieldSetElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const hoverClose = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const id = useId();
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !anchor.current?.contains(event.target)) {
        setPinned(false);
        setHovered(false);
        setFocused(false);
        setDismissed(true);
        clearTimeout(hoverClose.current);
      }
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (anchor.current?.contains(document.activeElement)) trigger.current?.focus();
        setPinned(false);
        setDismissed(true);
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', key);
    return () => {
      clearInterval(timer);
      clearTimeout(hoverClose.current);
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', key);
    };
  }, []);
  const failures = refresh?.failures ?? 0;
  const view = activityView(facts, failures);
  const open = !dismissed && (pinned || hovered || focused);
  const disconnected = failures >= 3;
  const warning = disconnected || view.summary === 'Status unknown';
  const lastSuccess = refresh?.lastSuccess;
  return (
    <fieldset
      ref={anchor}
      aria-label="Factory activity"
      className={`fa-anchor ${paused ? 'fa-paused' : ''}`}
      onMouseEnter={() => {
        clearTimeout(hoverClose.current);
        setHovered(true);
        setDismissed(false);
      }}
      onMouseLeave={() => {
        hoverClose.current = setTimeout(() => setHovered(false), 450);
      }}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
    >
      <button
        ref={trigger}
        type="button"
        className={`fa-summary ${warning ? 'fa-warning' : ''}`}
        aria-expanded={open}
        aria-controls={id}
        onFocus={() => setDismissed(false)}
        onClick={() => {
          setPinned(!pinned);
          setDismissed(false);
        }}
      >
        <i
          className={`fa-dot ${view.selected && !disconnected ? 'active' : ''} ${view.summary === 'Idle' ? 'idle' : ''}`}
          role="img"
          aria-label={
            paused ? 'Admissions paused' : view.selected && !disconnected ? 'Active' : view.summary
          }
        />
        <span>
          <b>{view.summary}</b>
        </span>
        {view.selected && !disconnected && (
          <time>{activityDuration(view.selected.startedAt, now)}</time>
        )}
      </button>
      {open && (
        <section id={id} className="fa-details" aria-label="Factory activity details">
          {view.unknown && (
            <p className="fa-warning">
              {view.coverageIncomplete && 'Activity coverage incomplete. '}
              {facts?.uncertainty.join(' ')}
            </p>
          )}
          <div className="fa-rows">
            {view.groups.map((group) => (
              <div
                key={group.category}
                className={`fa-row ${group.count ? 'is-active' : ''}`}
                title={
                  group.count
                    ? group.items.map((item) => item.reason).join('. ')
                    : group.unknown
                      ? 'Activity unknown'
                      : 'Inactive'
                }
              >
                <i
                  className={`fa-dot ${group.count ? 'active' : ''}`}
                  role="img"
                  aria-label={
                    group.count ? 'Active' : group.unknown ? 'Activity unknown' : 'Inactive'
                  }
                />
                <b>{group.name}</b>
                {group.count > 0 && (
                  <div className="fa-metric">
                    <span>{group.metric}</span>
                    <time>{activityDuration(group.startedAt, now)}</time>
                  </div>
                )}
              </div>
            ))}
          </div>
          {!!facts?.admissionReasons.length && (
            <div className="fa-restrictions">
              <small>New work</small>
              <ul>
                {facts.admissionReasons.map((reason) => (
                  <li key={reason.code}>{reason.message}</li>
                ))}
              </ul>
            </div>
          )}
          <footer className="fa-updated">
            {failures > 0 && (
              <span className="fa-warning">
                {disconnected ? 'Disconnected · last known data' : `Refresh failed ${failures}/3`}
              </span>
            )}
            {lastSuccess != null ? (
              <>
                <time dateTime={new Date(lastSuccess).toISOString()}>
                  Updated{' '}
                  {new Date(lastSuccess)
                    .toISOString()
                    .replace('T', ' ')
                    .replace(/\.\d+Z$/, ' UTC')}
                </time>
                <span title={activityAge(lastSuccess, now)}>
                  {activityDuration(new Date(lastSuccess).toISOString(), now)} ago
                </span>
              </>
            ) : (
              <span>No successful refresh</span>
            )}
          </footer>
        </section>
      )}
    </fieldset>
  );
}
