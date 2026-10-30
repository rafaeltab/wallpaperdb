import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { command } from '../../platform/index.js';
interface Configuration {
  binary: string;
  project: string;
  mcpEndpoint?: string;
  mcpAuthorizationFile?: string;
}
export async function mcpCall(
  config: Configuration,
  tool: string,
  args: object,
  signal?: AbortSignal
) {
  if (!config.mcpEndpoint || !config.mcpAuthorizationFile)
    throw new Error('Structured T3 MCP requires an endpoint and authorization file');
  const authorization = (await readFile(config.mcpAuthorizationFile, 'utf8')).trim();
  const raw = await command(
    config.binary,
    ['acp-mcp-call', tool, JSON.stringify(args)],
    config.project,
    signal,
    {
      T3_ACP_MCP_ENDPOINT: config.mcpEndpoint,
      T3_ACP_MCP_AUTHORIZATION: authorization,
    }
  );
  const envelope = z
    .object({
      structuredContent: z.unknown().optional(),
      content: z.array(z.object({ type: z.string(), text: z.string().optional() })).optional(),
      isError: z.boolean().optional(),
    })
    .parse(JSON.parse(raw));
  if (envelope.isError) throw new Error('T3 MCP request failed');
  return (
    envelope.structuredContent ??
    JSON.parse(envelope.content?.find((item) => item.type === 'text')?.text ?? 'null')
  );
}
const activity = z.object({
  thread: z.object({ latestRunId: z.string().nullable() }),
  items: z.array(
    z.object({
      itemId: z.string(),
      runId: z.string().nullable(),
      type: z.string(),
      status: z.string(),
      text: z.string().nullable(),
      sourceThreadId: z.string(),
      visibility: z.string(),
    })
  ),
  hasMore: z.boolean(),
  nextPosition: z.number().nullable(),
});
export async function pendingQuestion(
  config: Configuration,
  threadId: string,
  signal?: AbortSignal
) {
  let afterPosition: number | undefined;
  let question: { id: string; text: string } | undefined;
  for (;;) {
    const page = activity.parse(
      await mcpCall(
        config,
        't3_thread_read',
        {
          threadId,
          view: 'activity',
          limit: 100,
          runLimit: 1,
          maxCharsPerItem: 16000,
          afterPosition,
        },
        signal
      )
    );
    for (const item of page.items) {
      if (
        item.type === 'user_input_request' &&
        item.status === 'waiting' &&
        item.sourceThreadId === threadId &&
        item.visibility === 'local' &&
        item.runId === page.thread.latestRunId
      )
        question = { id: item.itemId, text: item.text ?? 'Question awaiting an answer in T3' };
    }
    if (!page.hasMore) return question;
    if (page.nextPosition === null || page.nextPosition === afterPosition)
      throw new Error('T3 activity pagination did not advance');
    afterPosition = page.nextPosition;
  }
}
