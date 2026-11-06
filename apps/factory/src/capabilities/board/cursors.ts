/** Private token format. Clients use equality and never decode it. */
export function cursorPayload(value: string) {
  try {
    const text = Buffer.from(value, 'base64url').toString('utf8');
    if (Buffer.from(text).toString('base64url') !== value) return undefined;
    const parsed: unknown = JSON.parse(text);
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('scope' in parsed) ||
      !('epoch' in parsed) ||
      !('revision' in parsed)
    )
      return undefined;
    if (
      typeof parsed.scope !== 'string' ||
      typeof parsed.epoch !== 'string' ||
      typeof parsed.revision !== 'number' ||
      !Number.isSafeInteger(parsed.revision) ||
      parsed.revision < 0
    )
      return undefined;
    if (Object.keys(parsed).length !== 3) return undefined;
    return { scope: parsed.scope, epoch: parsed.epoch, revision: parsed.revision };
  } catch {
    return undefined;
  }
}
