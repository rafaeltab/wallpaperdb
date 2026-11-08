import { z } from 'zod';
import type { ActionId, FactoryV2Problem } from './contract.js';

const limit = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('unlimited') }).strict(),
  z.object({ kind: z.literal('limited'), maximum: z.number().int().positive().safe() }).strict(),
]);
const common = {
  commandId: z.string().uuid(),
  actionId: z.custom<ActionId>(
    (value) =>
      typeof value === 'string' &&
      value.startsWith('action:') &&
      value.length > 7 &&
      value.length <= 200
  ),
  precondition: z.string().min(1).max(512),
};
export const commandSchema = z.discriminatedUnion('kind', [
  z
    .object({
      ...common,
      kind: z.literal('configure'),
      payload: z
        .object({ paused: z.boolean(), concurrency: limit, admissionAllowance: limit })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...common,
      kind: z.literal('start'),
      payload: z.object({ context: z.string().max(16000) }).strict(),
    })
    .strict(),
  z
    .object({
      ...common,
      kind: z.enum(['resume', 'retry', 'cancel', 'preview-plan', 'acknowledge-planning-failures']),
      payload: z.object({}).strict(),
    })
    .strict(),
]);
export const changesQuery = z
  .object({
    after: z.string().min(1).max(512),
    waitMs: z.coerce.number().int().min(0).max(25000).default(0),
  })
  .strict();
export const eventsQuery = z.object({ after: z.string().min(1).max(512).optional() }).strict();
export const searchQuery = z
  .object({
    q: z.string().max(200).default(''),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    pageToken: z.string().min(1).max(1024).optional(),
  })
  .strict();
export const cursorSchema = z
  .object({ scope: z.string(), epoch: z.string(), revision: z.number().int().nonnegative().safe() })
  .strict();
export const pageSchema = z
  .object({ cursor: z.string(), query: z.string(), offset: z.number().int().nonnegative().safe() })
  .strict();
export function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}
export function decode<Value>(value: string, schema: z.ZodType<Value>): Value | undefined {
  try {
    const text = Buffer.from(value, 'base64url').toString('utf8');
    if (Buffer.from(text).toString('base64url') !== value) return undefined;
    const parsed = schema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}
export function problem(
  status: number,
  code: FactoryV2Problem['code'],
  detail: string,
  commandId: string | null = null
): FactoryV2Problem {
  const type =
    status === 500
      ? 'generic-server'
      : code === 'origin-rejected'
        ? 'factory-origin'
        : code === 'invalid-request' || code === 'unsupported'
          ? 'factory-request'
          : code === 'unavailable'
            ? 'factory-unavailable'
            : code === 'not-found'
              ? 'factory-not-found'
              : 'factory-command';
  return {
    type: `https://github.com/rafaeltab/wallpaperdb/blob/main/docs/problems/${type}.md`,
    status,
    code,
    title: 'Factory v2 request rejected',
    detail,
    retry: code === 'stale-action' ? 'refresh' : code === 'unavailable' ? 'later' : 'never',
    commandId,
  };
}
export function matches(header: string | undefined, etag: string, weak: boolean): boolean {
  return (
    header?.split(',').some((value) => {
      const entry = value.trim();
      return entry === '*' || entry === etag || (weak && entry === `W/${etag}`);
    }) ?? false
  );
}
export const entityParams = z.object({ id: z.string().min(1).max(200) }).strict();
export const receiptParams = z.object({ id: z.string().uuid() }).strict();
