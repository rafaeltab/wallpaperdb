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
  const { endpoint, authorization } = await mcpAuthorization(config);
  const raw = await command(
    config.binary,
    ['acp-mcp-call', tool, JSON.stringify(args)],
    config.project,
    signal,
    {
      T3_ACP_MCP_ENDPOINT: endpoint,
      T3_ACP_MCP_AUTHORIZATION: authorization,
    }
  );
  return mcpResult(raw);
}
async function mcpAuthorization(config: Configuration) {
  if (!config.mcpEndpoint || !config.mcpAuthorizationFile)
    throw new Error('Structured T3 MCP requires an endpoint and authorization file');
  return {
    endpoint: config.mcpEndpoint,
    authorization: (await readFile(config.mcpAuthorizationFile, 'utf8')).trim(),
  };
}
function mcpResult(raw: string) {
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
  expectedRunId: string | null,
  signal?: AbortSignal
) {
  let afterPosition: number | undefined;
  let question: { id: string; text: string } | undefined;
  const answeredQuestions: string[] = [];
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
    verifyRun(page, expectedRunId);
    question = questionOnPage(page, threadId) ?? question;
    answeredQuestions.push(...answeredOnPage(page, threadId));
    if (!page.hasMore) return { question, answeredQuestions };
    afterPosition = followingPosition(page, afterPosition);
  }
}

function isCurrentQuestion(
  item: z.infer<typeof activity>['items'][number],
  threadId: string,
  runId: string | null
) {
  return (
    item.type === 'user_input_request' &&
    item.status === 'waiting' &&
    item.sourceThreadId === threadId &&
    item.visibility === 'local' &&
    item.runId === runId
  );
}

function verifyRun(page: z.infer<typeof activity>, expectedRunId: string | null) {
  if (page.thread.latestRunId !== expectedRunId)
    throw new Error('T3 run changed during question observation');
}
function questionOnPage(page: z.infer<typeof activity>, threadId: string) {
  const item = [...page.items]
    .reverse()
    .find((candidate) => isCurrentQuestion(candidate, threadId, page.thread.latestRunId));
  return item
    ? { id: item.itemId, text: item.text ?? 'Question awaiting an answer in T3' }
    : undefined;
}
function followingPosition(page: z.infer<typeof activity>, previous: number | undefined) {
  if (page.nextPosition === null || page.nextPosition === previous)
    throw new Error('T3 activity pagination did not advance');
  return page.nextPosition;
}

function answeredOnPage(page: z.infer<typeof activity>, threadId: string) {
  return page.items
    .filter(
      (item) =>
        item.type === 'user_input_request' &&
        item.status === 'completed' &&
        item.sourceThreadId === threadId &&
        item.visibility === 'local'
    )
    .map((item) => item.itemId);
}
