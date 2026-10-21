import { expect } from 'vitest';
import type { CaseScope } from './fixture';

export const caseNames = ['set-get', 'hashes', 'lists', 'expiration', 'pub-sub'] as const;
export type CaseName = (typeof caseNames)[number];

// The five assertions from tests/redis.test.ts, shared verbatim by both measured modes.
// Unique names and bounded observations replace fixed keys/channels and fixed sleeps.
export async function runOperation(name: CaseName, scope: CaseScope) {
  const { client } = scope;
  const key = scope.key('data');
  switch (name) {
    case 'set-get':
      await client.set(key, 'test-value');
      expect(await client.get(key)).toBe('test-value');
      break;
    case 'hashes': {
      await client.hSet(key, { name: 'John Doe', email: 'john@example.com', age: '30' });
      const user = await client.hGetAll(key);
      expect(user.name).toBe('John Doe');
      expect(user.email).toBe('john@example.com');
      expect(user.age).toBe('30');
      break;
    }
    case 'lists':
      await client.rPush(key, ['item1', 'item2', 'item3']);
      expect(await client.lLen(key)).toBe(3);
      expect(await client.lRange(key, 0, -1)).toEqual(['item1', 'item2', 'item3']);
      break;
    case 'expiration':
      await client.set(key, 'value', { EX: 1 });
      expect(await client.get(key)).toBe('value');
      await expect.poll(() => client.get(key), { timeout: 3000, interval: 20 }).toBeNull();
      break;
    case 'pub-sub': {
      const channel = scope.channel('messages');
      const messages: string[] = [];
      await scope.subscribe(channel, (message) => messages.push(message));
      for (const message of ['message1', 'message2', 'message3']) {
        await client.publish(channel, message);
      }
      await expect
        .poll(() => messages, { timeout: 3000, interval: 20 })
        .toEqual(['message1', 'message2', 'message3']);
      break;
    }
  }
}
