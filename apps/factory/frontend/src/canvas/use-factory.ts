import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  Action,
  FactoryV2CommandReceipt,
  FactoryV2Snapshot,
} from '../../../src/http/index.js';
import type { FactoryClient, CommandInput } from './client';
export function useFactory(client: FactoryClient) {
  const [board, setBoard] = useState<FactoryV2Snapshot>();
  const [error, setError] = useState('');
  const [commandError, setCommandError] = useState('');
  const [receipt, setReceipt] = useState<FactoryV2CommandReceipt>();
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const mounted = useRef(false),
    reserved = useRef(false),
    fresh = useRef(false);
  const refresh = useCallback(() => setRevision((n) => n + 1), []);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Explicit refresh restarts this request lifetime.
  useEffect(() => {
    let active = true,
      timer: ReturnType<typeof setTimeout>;
    let controller = new AbortController();
    let interval = 1000;
    let generation = 0;
    async function poll() {
      const ownGeneration = ++generation;
      const ownController = new AbortController();
      controller = ownController;
      try {
        const next = await client.board(ownController.signal);
        if (!active || ownGeneration !== generation) return;
        if (next) {
          setBoard(next);
          interval = Math.max(1000, Math.min(30000, next.meta.transport.suggestedPollMs));
        }
        fresh.current = true;
        setError('');
      } catch (e) {
        if (active && ownGeneration === generation && !ownController.signal.aborted) {
          fresh.current = false;
          setError(e instanceof Error ? e.message : 'Board unavailable');
        }
      } finally {
        if (active && ownGeneration === generation) timer = setTimeout(poll, interval);
      }
    }
    function hide() {
      active = false;
      generation++;
      fresh.current = false;
      clearTimeout(timer);
      controller.abort();
    }
    function show() {
      if (!active) {
        active = true;
        void poll();
      }
    }
    window.addEventListener('pagehide', hide);
    window.addEventListener('pageshow', show);
    void poll();
    return () => {
      hide();
      window.removeEventListener('pagehide', hide);
      window.removeEventListener('pageshow', show);
    };
  }, [client, revision]);
  useEffect(() => {
    if (!receipt || !['accepted', 'running'].includes(receipt.state)) return;
    let active = true;
    const timer = setTimeout(() => {
      void client
        .receipt(receipt.commandId)
        .then((next) => {
          if (active) {
            setReceipt(next);
            setCommandError('');
            refresh();
          }
        })
        .catch((e) => {
          if (active) {
            setCommandError(`Receipt unavailable: ${String(e)}`);
            setReceipt({ ...receipt });
          }
        });
    }, 1000);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [client, receipt, refresh]);
  async function run(operation: () => Promise<FactoryV2CommandReceipt>) {
    if (reserved.current) return;
    reserved.current = true;
    setBusy(true);
    setCommandError('');
    try {
      const result = await operation();
      if (mounted.current) {
        setReceipt(result);
        refresh();
      }
    } catch (e) {
      if (mounted.current) {
        setCommandError(e instanceof Error ? e.message : 'Command failed');
        refresh();
      }
    } finally {
      reserved.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return {
    board,
    error,
    commandError,
    receipt,
    busy: busy || (!!receipt && ['accepted', 'running'].includes(receipt.state)),
    refresh,
    uncertain: client.uncertainCommand,
    submit: (action: Action, input: CommandInput) =>
      run(() => {
        if (!fresh.current)
          throw new Error('Refresh the unavailable board before sending commands.');
        if (receipt && ['accepted', 'running', 'uncertain'].includes(receipt.state))
          throw new Error('Resolve the current command first.');
        return client.submit(action, input);
      }),
    retry: () => run(() => client.retry()),
    observe: () => run(() => client.reconcile()),
  };
}
export type Factory = ReturnType<typeof useFactory>;
