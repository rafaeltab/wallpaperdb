import { useEffect, useState } from 'react';
import type { Action, WorkItem } from '../../../src/http/index.js';
import { FactoryClient } from './client';
import { useFactory } from './use-factory';
import { Canvas } from './canvas';
import { subject } from './model';
import { CommandFeedback } from './feedback';
import { Controls, Details, Panel, Plan, Start } from './panels';
import './style.css';
export function FactoryApp({ client: provided }: { client?: FactoryClient }) {
  const [client] = useState(() => provided ?? new FactoryClient());
  const factory = useFactory(client),
    board = factory.board;
  const [panel, setPanel] = useState<'settings' | 'start' | 'plan' | 'details' | 'cancel'>();
  const [selected, setSelected] = useState<WorkItem['id']>();
  const [cancelAction, setCancelAction] = useState<Action>();
  const [native, setNative] = useState(false);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 10000);
    return () => clearInterval(timer);
  }, []);
  const item = selected && board ? board.entities.items[selected] : undefined;
  const close = () => setPanel(undefined);
  const busy = factory.commandsBlocked;
  const command = (selected: WorkItem, action: Action) => {
    setSelected(selected.id);
    if (action.kind === 'cancel') {
      setCancelAction(action);
      setPanel('cancel');
      return;
    }
    if (action.kind === 'resume') void factory.submit(action, { kind: 'resume', payload: {} });
  };
  return (
    <main className="fc-app">
      <header className="fc-toolbar">
        <strong>Factory</strong>
        <span className={board?.meta.factory.paused ? 'fc-paused' : 'fc-live'}>
          {board ? (board.meta.factory.paused ? 'Paused' : 'Running') : 'Connecting'}
        </span>
        {board?.meta.dataMode === 'fake' && (
          <span className="fc-fake">Fake data · commands are simulated</span>
        )}
        <span className="fc-space" />
        {board && (
          <>
            <span>
              {board.meta.factory.concurrency.occupied} active ·{' '}
              {board.meta.factory.admission.consumed} admitted
            </span>
            <button
              type="button"
              onClick={() => {
                setSelected(undefined);
                setPanel('start');
              }}
            >
              Start issue
            </button>
            <button type="button" onClick={() => setPanel('plan')}>
              Plan preview
            </button>
            <button type="button" onClick={() => setPanel('settings')}>
              Settings
            </button>
          </>
        )}
        <button type="button" onClick={factory.refresh}>
          Refresh
        </button>
      </header>
      {factory.error && (
        <div className="fc-banner" role="alert">
          {factory.error}.{' '}
          {board
            ? 'Showing last-known board. Commands are disabled.'
            : 'The v2 server may be unavailable.'}{' '}
          <a href="?view=operations">Open operations UI</a>
        </div>
      )}
      {board && (
        <div className="fc-source-bar">
          <span>Coverage {board.meta.coverage.state}</span>
          {Object.values(board.entities.sources).map((source) => (
            <span
              key={source.id}
              title={[source.observedAt ?? 'Never observed', source.failure?.message]
                .filter(Boolean)
                .join(' · ')}
            >
              {source.kind}: {source.refresh}
              {source.staleAt && Date.parse(source.staleAt) <= now ? ' · stale' : ''} ·{' '}
              {source.observedAt ?? 'unobserved'}
            </span>
          ))}
          {board.meta.coverage.reasons.map((r) => (
            <span key={r.code}>{r.message}</span>
          ))}
          {board.meta.diagnostics.map((r) => (
            <span key={r.code}>{r.message}</span>
          ))}
        </div>
      )}
      {board ? (
        <Canvas
          key={board.scopeId}
          board={board}
          native={native}
          busy={busy}
          onDetails={(i) => {
            setSelected(i.id);
            setPanel('details');
          }}
          onStart={(i) => {
            setSelected(i.id);
            setPanel('start');
          }}
          onCommand={command}
        />
      ) : (
        !factory.error && (
          <p role="status" className="fc-empty">
            Loading factory board…
          </p>
        )
      )}
      {!panel && <CommandFeedback factory={factory} />}
      {board && panel === 'settings' && <Controls board={board} factory={factory} close={close} />}
      {board && panel === 'start' && (
        <Start
          initialQuery={item ? String(subject(board, item)?.number ?? '') : ''}
          client={client}
          factory={factory}
          close={close}
        />
      )}
      {board && panel === 'plan' && (
        <Plan
          key={`${board.meta.currentPlanId}:${board.meta.currentPlanId ? board.entities.plans[board.meta.currentPlanId]?.version : ''}`}
          board={board}
          client={client}
          factory={factory}
          close={close}
        />
      )}
      {board &&
        panel === 'details' &&
        (item ? (
          <Details
            board={board}
            item={item}
            client={client}
            factory={factory}
            close={close}
            native={native}
          />
        ) : (
          <Panel name="Work item details" close={close}>
            <p>This work item is no longer on the board.</p>
          </Panel>
        ))}
      {board && panel === 'cancel' && item && (
        <Panel name="Cancel job" close={close}>
          <p>Cancel this job? Its admission remains consumed.</p>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (cancelAction) void factory.submit(cancelAction, { kind: 'cancel', payload: {} });
              close();
            }}
          >
            Confirm cancellation
          </button>
        </Panel>
      )}
      <label className="fc-link-preference">
        <input type="checkbox" checked={native} onChange={(e) => setNative(e.target.checked)} />{' '}
        Open T3 links in app
      </label>
    </main>
  );
}
