import crypto from 'node:crypto';
import { inject, singleton } from 'tsyringe';
import type { Config } from '../config.js';
import { InvalidCursorError } from '../errors/graphql-errors.js';

/**
 * Service for encoding/decoding secure cursors with HMAC signatures
 */
@singleton()
export class CursorService {
  private readonly secret: string;

  constructor(@inject('config') private readonly config: Config) {
    this.secret = config.cursorSecret;
  }

  /**
   * Encode offset into opaque cursor with HMAC signature
   */
  encode(offset: number): string {
    const payload = JSON.stringify({ offset, timestamp: Date.now() });
    const signature = crypto.createHmac('sha256', this.secret).update(payload).digest('hex');

    const cursor = Buffer.from(
      JSON.stringify({
        payload,
        signature,
      })
    ).toString('base64url');

    return cursor;
  }

  /**
   * Decode cursor and verify signature
   */
  decode(cursor: string): number {
    try {
      const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf-8'));

      const { payload, signature } = decoded;

      // Verify signature
      const expectedSignature = crypto
        .createHmac('sha256', this.secret)
        .update(payload)
        .digest('hex');

      if (signature !== expectedSignature) {
        throw new Error('Invalid cursor signature');
      }

      const { offset, timestamp } = JSON.parse(payload);

      // Check cursor age
      const age = Date.now() - timestamp;
      if (age > this.config.cursorExpirationMs) {
        throw new Error('Cursor expired');
      }

      return offset;
    } catch (error) {
      throw new InvalidCursorError(
        error instanceof Error ? error.message : 'Invalid or expired cursor'
      );
    }
  }
}
