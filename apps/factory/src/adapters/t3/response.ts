import { z } from 'zod';
import type { AgentResponse } from '../../capabilities/job/index.js';
export const receiptSchema = z.discriminatedUnion('kind', [
  z
    .object({
      version: z.literal(1),
      kind: z.literal('state'),
      jobId: z.string(),
      checks: z
        .object({
          format: z.boolean(),
          lint: z.boolean(),
          tests: z.boolean(),
          crap: z.boolean(),
          coverage: z.boolean(),
        })
        .strict(),
      base: z.string(),
      implemented: z.string(),
      checked: z.string(),
      reviewed: z.string().optional(),
      published: z.string().optional(),
    })
    .strict(),
  z
    .object({
      version: z.literal(1),
      kind: z.literal('dependencies'),
      jobId: z.string(),
      requireUnimplementedIssues: z.array(z.string()),
    })
    .strict(),
]) satisfies z.ZodType<AgentResponse>;
export const responseShape = `type AgentResponse =
  | { version: 1; kind: 'state'; jobId: string;
      checks: { format: boolean; lint: boolean; tests: boolean; crap: boolean; coverage: boolean };
      base: string; implemented: string; checked: string; reviewed?: string; published?: string }
  | { version: 1; kind: 'dependencies'; jobId: string; requireUnimplementedIssues: string[] };`;
export function latestStructured(
  messages: readonly { readonly role: string; readonly text: string }[]
) {
  return [...messages].reverse().find((m) => {
    if (m.role !== 'assistant') return false;
    const value = responseValue(m.text);
    if (value === undefined) return malformedResponse(m.text);
    return (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      ('jobId' in value ||
        'version' in value ||
        ('kind' in value && (value.kind === 'state' || value.kind === 'dependencies')))
    );
  });
}
export function latestRecoveryResponse(
  messages: readonly { readonly role: string; readonly text: string }[]
) {
  return [...messages].reverse().find((message) => {
    if (message.role !== 'assistant') return false;
    const reply = recoveryResponse(message.text);
    if (latestStructured([{ ...message, text: reply.text }])) return true;
    const value = responseValue(reply.text);
    if (value === undefined)
      return malformedResponse(reply.text, (key) => key === 'operation' || key === 'outcome');
    return (
      value !== null && typeof value === 'object' && ('operation' in value || 'outcome' in value)
    );
  });
}
/** Recovery classification may be its own message or a line before the JSON receipt. */
export function recoveryResponse(text: string) {
  const prefix = /^\s*(<RESTACK>(?:SIMPLE|COMPLEX)<\/RESTACK>)(?:\r?\n|$)/.exec(text);
  return { classification: prefix?.[1], text: prefix ? text.slice(prefix[0].length) : text };
}
export function responseValue(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
function malformedResponse(text: string, matchesField = responseField) {
  const start = /^\s*(?:```[^\r\n]*\r?\n\s*)?\{/.exec(text);
  if (!start) return false;
  let depth = 0;
  let key = false;
  for (let index = start[0].length - 1; index < text.length; index++) {
    const character = text[index];
    if (character === '"') {
      const end = stringEnd(text, index);
      if (end >= text.length) return false;
      const tail = text.slice(end + 1);
      if (depth === 1 && (key || /^\s*:/.test(tail))) {
        if (matchesField(responseValue(text.slice(index, end + 1)), tail)) return true;
        key = false;
      } else if (depth === 1) {
        key = true;
      }
      index = end;
    } else if (character === '{' || character === '[') {
      depth++;
      if (depth === 1) key = true;
    } else if (character === '}' || character === ']') {
      depth--;
      if (depth === 1) key = true;
    } else if (depth === 1 && character !== ':' && Boolean(character?.trim())) {
      key = true;
    }
  }
  return false;
}
function stringEnd(text: string, start: number) {
  for (let index = start + 1; index < text.length; index++) {
    if (text[index] === '\\') index++;
    else if (text[index] === '"') return index;
  }
  return text.length;
}
function responseField(key: unknown, tail: string) {
  if (key === 'jobId' || key === 'version') return true;
  if (key !== 'kind') return false;
  const separator = /^\s*:\s*/.exec(tail);
  if (!separator) return true;
  const value = tail.slice(separator[0].length);
  if (!value.startsWith('"')) return false;
  const raw = value.slice(0, stringEnd(value, 0) + 1);
  const kinds = ['state', 'dependencies'];
  const kind = responseValue(raw);
  if (kind !== undefined) return kinds.some((candidate) => candidate === kind);
  let prefix = '';
  for (let index = 1; index < raw.length; index++) {
    let character = raw.charAt(index);
    if (character === '\\') {
      const length = raw[index + 1] === 'u' ? 6 : 2;
      const decoded = responseValue(`"${raw.slice(index, index + length)}"`);
      if (typeof decoded !== 'string') return true;
      character = decoded;
      index += length - 1;
    } else if (character.charCodeAt(0) < 32) {
      return true;
    }
    prefix += character;
    if (!kinds.some((candidate) => candidate.startsWith(prefix))) return false;
  }
  return true;
}
