import { useState } from 'react';
import type { Action, WorkItem } from '../../../src/http/index.js';
import { FactoryClient } from './client';
import { useFactory } from './use-factory';
import { Canvas } from './canvas';
import type { TitleMode, RelationshipMode } from './geometry-types';
import { subject } from './model';
import { SourceCoverage } from './sources';
import { CommandFeedback } from './feedback';
import { Controls, Details, Panel, Plan, Start } from './panels';
import { PlanningNotice, planningResumeBlocked } from './planning-notice';
import './style.css';
export function FactoryApp({ client: provided }: { client?: FactoryClient }) {
  const [client] = useState(() => provided ?? new FactoryClient());
  const factory = useFactory(client),
    board = factory.board;
  const [panel, setPanel] = useState<'settings' | 'start' | 'plan' | 'details' | 'cancel'>();
  const [selected, setSelected] = useState<WorkItem['id']>();
  const [cancelAction, setCancelAction] = useState<Action>();
  const [native, setNative] = useState(false);
  const [titleMode, setTitleMode] = useState<TitleMode>(() =>
    new URLSearchParams(location.search).get('titles') === 'wrap'
      ? 'wrap'
      : new URLSearchParams(location.search).get('titles') === 'expand'
        ? 'expand'
        : 'ellipsis'
  );
  const [reach, setReach] = useState<RelationshipMode>(() =>
    new URLSearchParams(location.search).get('reach') === 'all'
      ? 'all'
      : new URLSearchParams(location.search).get('reach') === 'transitive'
        ? 'transitive'
        : 'direct'
  );
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
  const configure = board?.meta.factory.actionIds
    .map((id) => board.entities.actions[id])
    .find((a) => a?.kind === 'configure');
  const panels = (
    <>
      {factory.error && (
        <div className="fc-banner" role="alert">
          {factory.error}.{' '}
          {board
            ? 'Showing last-known board. Commands are disabled.'
            : 'The v2 server may be unavailable.'}{' '}
          <button type="button" onClick={factory.refresh}>
            Refresh
          </button>{' '}
          <a href="?view=operations">Open operations UI</a>
        </div>
      )}
      {!panel && <CommandFeedback factory={factory} />}
      {board && panel === 'settings' && (
        <Controls board={board} factory={factory} close={close}>
          <label>
            Long names
            <select
              aria-label="Long name behavior"
              value={titleMode}
              onChange={(e) =>
                setTitleMode(
                  e.target.value === 'wrap'
                    ? 'wrap'
                    : e.target.value === 'expand'
                      ? 'expand'
                      : 'ellipsis'
                )
              }
            >
              <option value="wrap">Wrap</option>
              <option value="ellipsis">Ellipsis + tooltip</option>
              <option value="expand">Expand in place</option>
            </select>
          </label>
          <label>
            Relationships
            <select
              aria-label="Relationship depth"
              value={reach}
              onChange={(e) =>
                setReach(
                  e.target.value === 'all'
                    ? 'all'
                    : e.target.value === 'transitive'
                      ? 'transitive'
                      : 'direct'
                )
              }
            >
              <option value="direct">Direct only</option>
              <option value="transitive">Transitive, no parent highlight</option>
              <option value="all">Transitive + parents</option>
            </select>
          </label>
          <label>
            T3 links
            <select
              aria-label="T3 link destination"
              value={native ? 'native' : 'web'}
              onChange={(e) => setNative(e.target.value === 'native')}
            >
              <option value="web">Website</option>
              <option value="native">Native app</option>
            </select>
          </label>
          <SourceCoverage board={board} refresh={factory.refresh} />
        </Controls>
      )}
      {board && panel === 'start' && (
        <Start
          key={selected ?? 'search'}
          initialQuery={item ? String(subject(board, item)?.number ?? '') : ''}
          client={client}
          factory={factory}
          close={close}
        />
      )}
      {board && panel === 'plan' && (
        <Plan
          native={native}
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
    </>
  );
  return board ? (
    <Canvas
      key={board.scopeId}
      board={board}
      native={native}
      titleMode={titleMode}
      reach={reach}
      busy={busy}
      notice={<PlanningNotice board={board} factory={factory} native={native} />}
      onSettings={() => setPanel(panel === 'settings' ? undefined : 'settings')}
      onPlan={() => setPanel(panel === 'plan' ? undefined : 'plan')}
      onStartIssue={() => {
        setSelected(undefined);
        setPanel(panel === 'start' ? undefined : 'start');
      }}
      canConfigure={configure?.availability.state === 'available' && !planningResumeBlocked(board)}
      onPause={() => {
        if (configure)
          void factory.submit(configure, {
            kind: 'configure',
            payload: {
              paused: !board.meta.factory.paused,
              concurrency: board.meta.factory.concurrency.limit,
              admissionAllowance: board.meta.factory.admission.limit,
            },
          });
      }}
      onDetails={(i) => {
        setSelected(i.id);
        setPanel('details');
      }}
      onStart={(i) => {
        setSelected(i.id);
        setPanel('start');
      }}
      onCommand={command}
    >
      {panels}
    </Canvas>
  ) : (
    <main className="cc-app">
      <p className="cc-empty" role="status">
        Loading factory board…
      </p>
      {panels}
    </main>
  );
}
