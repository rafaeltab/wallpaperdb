import { appendFileSync } from 'node:fs';
import type { QueryClient } from '@tanstack/react-query';
import { onTestFinished } from 'vitest';

// Diagnostic only. Keep wall time distinct from CPU, promise settlement and UI publication.
export function createCropTrace() {
  const start = performance.now();
  const cpu = process.cpuUsage();
  const records: unknown[] = [];
  let overheadMs = 0;
  let maxLagMs = 0;
  let previous = start;
  const mark = (phase: string, detail?: unknown) => {
    const entered = performance.now();
    if (records.length < 256) records.push({
      phase, wallMs: entered - start, cpuUs: process.cpuUsage(cpu), maxLagMs, detail,
    });
    overheadMs += performance.now() - entered;
  };
  const timer = setInterval(() => {
    const now = performance.now();
    maxLagMs = Math.max(maxLagMs, now - previous - 50);
    previous = now;
  }, 50);
  const cleanup: (() => void)[] = [];
  onTestFinished((context) => {
    clearInterval(timer);
    for (const stop of cleanup) stop();
    mark('finished', {
      pickerDisabled: document.querySelector<HTMLInputElement>('input[type=file]')?.disabled,
      zoom: document.querySelector<HTMLInputElement>('#picture-zoom')?.value,
      dialogCount: document.querySelectorAll('[role=dialog]').length,
    });
    appendFileSync(`/tmp/flake537-trace-${process.pid}.jsonl`, `${JSON.stringify({
      state: context.task.result?.state, name: context.task.name, overheadMs, records,
    })}\n`);
  });
  mark('start');
  return {
    mark,
    measure<T>(phase: string, operation: () => T): T {
      mark(`${phase}:enter`);
      try { return operation(); } finally { mark(`${phase}:complete`); }
    },
    resolved<T>(phase: string, value: T): Promise<T> {
      mark(`${phase}:called`);
      const promise = Promise.resolve(value);
      void promise.then(() => mark(`${phase}:settled`));
      return promise;
    },
    watch(client: QueryClient) {
      cleanup.push(client.getQueryCache().subscribe((event) => {
        if (event.query.queryKey.includes('picture-policy')) mark('policy-cache', {
          event: event.type, status: event.query.state.status,
          fetchStatus: event.query.state.fetchStatus, hasData: Boolean(event.query.state.data),
        });
      }));
      cleanup.push(client.getMutationCache().subscribe((event) => {
        mark('mutation-cache', { event: event.type, status: event.mutation?.state.status });
      }));
    },
  };
}
