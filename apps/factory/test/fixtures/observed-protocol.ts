import { watch } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { runProtocol } from './protocol.js';
import { websocketProtocol } from './websocket.js';

interface Message {
  role: string;
  text: string;
  runId?: string;
}
interface Activity {
  itemId: string;
  runId?: string | null;
  type: string;
  status: string;
  text?: string | null;
  position?: number;
  createdBy?: string | null;
  creationSource?: string | null;
}

/** Simulated T3 server owns its fixture state. Factory clients see the real WS protocol. */
export async function observedProtocol(directory: string, configFile: string) {
  const clients = new Set<{
    id: string;
    thread?: string;
    send: (value: unknown) => void;
    signal: AbortSignal;
    previous?: string;
  }>();
  let sequence = 1;
  let queued = false;
  let refreshing = false;
  let closed = false;
  const invoke = async (args: string[], signal: AbortSignal) => {
    const output: string[] = [];
    const code = await runProtocol(
      { ...process.env, FACTORY_FIXTURE: configFile, FACTORY_WS_FIXTURE: '1' },
      [process.execPath, 't3', ...args],
      { log: (text) => output.push(text), error: () => undefined },
      signal
    );
    if (code !== 0) throw new Error('Controlled T3 observation failed');
    const value = JSON.parse(output.join('\n'));
    return value.structuredContent ?? value;
  };
  const shellRows = async () => {
    const config = JSON.parse(await readFile(configFile, 'utf8'));
    const rows: Record<string, unknown>[] = [];
    for (const name of await readdir(directory)) {
      if (!/^(?:resource(?:-.*)?|restacker.*|planner)\.json$/.test(name)) continue;
      const resource = JSON.parse(await readFile(join(directory, name), 'utf8'));
      const value = resource.thread ?? resource;
      const id = name === 'planner.json' ? 'planner-thread' : value.threadId;
      if (!id) continue;
      const held =
        !['failed', 'interrupted', 'cancelled'].includes(
          config.overrides?.status ?? value.status
        ) &&
        ((value.stage === 'implementation' && config.holdImplementation) ||
          (value.stage === 'review' && config.holdReview) ||
          (value.stage === 'publication' && config.holdPublication));
      const status = held ? 'running' : (config.overrides?.status ?? value.status ?? 'completed');
      rows.push({
        ...value,
        ...config.overrides,
        id,
        projectId: 'project-id',
        title: value.title ?? 'Planner',
        lineage: { parentThreadId: null },
        archivedAt: null,
        status,
        latestRunId: config.overrides?.latestRunId ?? value.latestRunId ?? 'planner-run',
        activeRunId: ['preparing', 'queued', 'starting', 'running', 'waiting'].includes(status)
          ? (config.overrides?.latestRunId ?? value.latestRunId ?? 'planner-run')
          : null,
        blockedOnThreadWait: config.waitingForGithub === true && value.stage === 'babysitting',
        pendingBackgroundTasks: value.pendingBackgroundTasks ?? [],
        pullRequests: config.overrides?.pullRequests ?? value.pullRequests ?? [],
      });
    }
    for (const child of config.descendants ?? [])
      rows.push({
        ...child,
        id: child.threadId,
        projectId: 'project-id',
        title: child.threadId,
        lineage: { parentThreadId: child.parentThreadId },
        archivedAt: null,
        status: 'idle',
        latestRunId: null,
        activeRunId: null,
        blockedOnThreadWait: false,
        pendingBackgroundTasks: [],
        pullRequests: [],
        ...config.descendantSnapshots?.[child.threadId],
      });
    return config.omitThreadList
      ? []
      : config.duplicate
        ? rows.flatMap((row) => [row, { ...row, id: `${row.id}-conflicting` }])
        : rows;
  };
  const threadProjection = async (id: string, signal: AbortSignal) => {
    const detail = await invoke(['thread', 'show', id, '--messages', '1000', '--json'], signal);
    const activity = await invoke(
      [
        'acp-mcp-call',
        't3_thread_read',
        JSON.stringify({
          threadId: id,
          view: 'activity',
          afterPosition: -1,
          limit: 100,
          maxCharsPerItem: 16000,
        }),
      ],
      signal
    );
    const metadata = (await shellRows()).find((row) => row.id === id);
    const thread = detail.thread ?? activity.thread ?? metadata ?? {};
    const runId = thread.latestRunId ?? metadata?.latestRunId ?? null;
    const messages: Message[] = detail.messages ?? [];
    const historical = [
      ...new Set(
        messages
          .map((message) => message.runId)
          .filter((value): value is string => Boolean(value) && value !== runId)
      ),
    ];
    const count = Math.max(thread.runCount ?? 1, historical.length + (runId ? 1 : 0));
    const ids = [
      ...Array.from(
        { length: Math.max(0, count - historical.length - (runId ? 1 : 0)) },
        (_value, index) => `prior-${index}`
      ),
      ...historical,
      ...(runId ? [runId] : []),
    ];
    const runs = ids.map((id, index) => ({
      id,
      ordinal: index + 1,
      status: id === runId ? (thread.status ?? 'completed') : 'completed',
      completedAt: null,
    }));
    const turnItems = messages.map((message, index) => ({
      id: `message-${index}`,
      threadId: id,
      runId: message.runId ?? runId,
      nodeId: null,
      messageId: `message-${index}`,
      type: message.role === 'user' ? 'user_message' : 'assistant_message',
      ordinal: index,
      status: 'completed',
      text: message.text,
    }));
    const items = (activity.items ?? []).map((item: Activity, index: number) => ({
      id: item.itemId,
      threadId: id,
      runId: item.runId ?? runId,
      nodeId: null,
      type: item.type,
      ordinal: item.position ?? turnItems.length + index,
      status: item.status,
      text: item.text ?? null,
      ...(item.type === 'user_input_request' ? { questions: item.text } : {}),
    }));
    return {
      thread: {
        ...thread,
        id: thread.threadId ?? id,
        projectId: thread.projectId ?? 'project-id',
        title: thread.title ?? metadata?.title ?? id,
        lineage: metadata?.lineage ?? { parentThreadId: null },
        modelSelection: {
          instanceId: thread.providerInstanceId ?? 'codex',
          model: thread.model ?? 'gpt-6.1-sol',
          options: thread.options ?? [],
        },
        runtimeMode: thread.runtimeMode ?? 'full-access',
        branch: thread.branch ?? null,
        worktreePath: thread.worktreePath ?? null,
        pullRequests: thread.pullRequests ?? [],
      },
      runs,
      attempts: [],
      providerThreads: [],
      runtimeRequests: Array.from({ length: thread.pendingRequestCount ?? 0 }, (_value, index) => ({
        id: `request-${index}`,
        status: 'pending',
      })),
      messages: [
        ...messages.map((_message, index) => ({
          id: `message-${index}`,
          createdBy: 'agent',
          creationSource: 'mcp',
        })),
        ...(activity.items ?? [])
          .filter(
            (item: Activity) => item.type === 'user_message' || item.type === 'assistant_message'
          )
          .map((item: Activity) => ({
            id: item.itemId,
            createdBy: item.createdBy ?? null,
            creationSource: item.creationSource ?? null,
          })),
      ],
      turnItems: [...turnItems, ...items],
      visibleTurnItems: [],
    };
  };
  const refresh = async () => {
    if (refreshing || closed) {
      queued = true;
      return;
    }
    refreshing = true;
    try {
      do {
        queued = false;
        sequence++;
        for (const client of clients) {
          if (client.signal.aborted) {
            clients.delete(client);
            continue;
          }
          try {
            const value = client.thread
              ? await threadProjection(client.thread, client.signal)
              : {
                  schemaVersion: 1,
                  snapshotSequence: sequence,
                  threads: await shellRows(),
                  archivedThreads: [],
                  projects: [],
                };
            const serialized = JSON.stringify(value);
            if (serialized === client.previous) continue;
            client.previous = serialized;
            client.send({
              _tag: 'Chunk',
              requestId: client.id,
              values: [
                client.thread
                  ? { kind: 'snapshot', snapshotSequence: sequence, projection: value }
                  : { kind: 'snapshot', snapshot: value },
                { kind: 'synchronized' },
              ],
            });
          } catch {
            if (!client.signal.aborted)
              client.send({
                _tag: 'Exit',
                requestId: client.id,
                exit: { _tag: 'Failure', cause: [] },
              });
          }
        }
      } while (queued && !closed);
    } finally {
      refreshing = false;
    }
  };
  const schedule = () => {
    queued = true;
    queueMicrotask(() => {
      void refresh();
    });
  };
  const host = await websocketProtocol((raw, send, signal) => {
    const request = z
      .object({
        _tag: z.string(),
        id: z.string().optional(),
        tag: z.string().optional(),
        payload: z.object({ threadId: z.string().optional() }).optional(),
      })
      .parse(raw);
    if (request._tag !== 'Request' || !request.id) return;
    if (
      request.tag === 'orchestration.getArchivedShellSnapshot' ||
      request.tag === 'orchestration.getThreadFamily'
    ) {
      void shellRows().then((rows) =>
        send({
          _tag: 'Exit',
          requestId: request.id,
          exit: {
            _tag: 'Success',
            value: {
              snapshotSequence: sequence,
              threads: request.tag === 'orchestration.getThreadFamily' ? rows : [],
              projects: [],
            },
          },
        })
      );
      return;
    }
    if (
      !['orchestration.subscribeShell', 'orchestration.subscribeThread'].includes(request.tag ?? '')
    )
      return;
    const client = { id: request.id, thread: request.payload?.threadId, send, signal };
    clients.add(client);
    signal.addEventListener('abort', () => clients.delete(client), { once: true });
    schedule();
  });
  const watcher = watch(directory, (_event, filename) => {
    if (
      filename &&
      /^(?:resource|restacker|planner|config\.json|release)/.test(filename.toString())
    )
      schedule();
  });
  return {
    origin: host.origin,
    connections: host.connections,
    close: async () => {
      closed = true;
      watcher.close();
      await host.close();
    },
  };
}
