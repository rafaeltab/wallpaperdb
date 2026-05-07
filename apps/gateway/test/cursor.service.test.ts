import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CursorService } from '../src/services/cursor.service.js';

describe('CursorService', () => {
  const config = {
    cursorSecret: 'test-secret-that-is-definitely-long-enough',
    cursorExpirationMs: 60_000,
  } as const;

  it('encodes and decodes search_after values', () => {
    const service = new CursorService(config as never);
    const values = [42, 'wlpr_cursor_001'];

    const cursor = service.encode(values);
    const decodedCursor = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf-8'));
    const payload = JSON.parse(decodedCursor.payload);

    expect(payload).toMatchObject({ values });
    expect(payload).not.toHaveProperty('offset');
    expect(service.decode(cursor)).toEqual(values);
  });

  it('rejects expired cursors with search_after values', () => {
    const service = new CursorService(config as never);
    const payload = JSON.stringify({
      values: ['wlpr_cursor_002'],
      timestamp: Date.now() - config.cursorExpirationMs - 1,
    });
    const signature = crypto.createHmac('sha256', config.cursorSecret).update(payload).digest('hex');
    const cursor = Buffer.from(JSON.stringify({ payload, signature })).toString('base64url');

    expect(() => service.decode(cursor)).toThrow(/expired/i);
  });
});
