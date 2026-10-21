import { expect, it } from 'vitest';
import { createGroup } from './fixture';

it('cleans a failed case while an overlapping case retains its data and subscription', async () => {
  const group = await createGroup();
  try {
    await group.runCase('survivor', async (survivor) => {
      const key = survivor.key('same-name');
      const channel = survivor.channel('same-name');
      await survivor.client.set(key, 'survives');
      const messages: string[] = [];
      await survivor.subscribe(channel, (message) => messages.push(message));

      let failedChannel = '';
      await expect(
        group.runCase('failure', async (failed) => {
          await failed.client.set(failed.key('same-name'), 'removed');
          failedChannel = failed.channel('same-name');
          await failed.subscribe(failedChannel, () => {});
          expect.fail('intentional assertion failure');
        })
      ).rejects.toThrow('intentional assertion failure');

      expect(await survivor.client.get(key)).toBe('survives');
      expect(await survivor.client.dbSize()).toBe(1);
      expect((await survivor.client.pubSubNumSub(failedChannel))[failedChannel]).toBe(0);
      await survivor.client.publish(channel, 'still subscribed');
      await expect.poll(() => messages).toEqual(['still subscribed']);
    });
  } finally {
    await group.close();
  }
});
