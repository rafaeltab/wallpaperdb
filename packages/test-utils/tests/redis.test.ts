import Docker from 'dockerode';
import { createClient, type RedisClientType } from 'redis';
import { describe, expect, it } from 'vitest';
import { createDefaultTesterBuilder, DockerTesterBuilder, RedisTesterBuilder } from '../src/index';

const docker = new Docker();

describe('RedisTesterBuilder', { concurrent: true }, () => {
  it('should create a container', async () => {
    const Tester = createDefaultTesterBuilder()
      .with(DockerTesterBuilder)
      .with(RedisTesterBuilder)
      .build();

    const tester = new Tester().withRedis();
    try {
      await tester.setup();
      const containerId = tester.redis.config.container.getId();
      const existingContainers = await docker.listContainers();

      expect(existingContainers.map((x) => x.Id)).toContain(containerId);
    } finally {
      await tester.destroy();
    }
  });

  it('should create a container in the correct network', async () => {
    const Tester = createDefaultTesterBuilder()
      .with(DockerTesterBuilder)
      .with(RedisTesterBuilder)
      .build();

    const tester = new Tester().withNetwork().withRedis();
    try {
      await tester.setup();
      const networkName = tester.docker.network?.getName();
      const containerId = tester.redis.config.container.getId();

      expect(networkName).not.toBeNull();
      expect(containerId).not.toBeNull();

      const containers = await docker.listContainers();
      const container = containers.find((x) => x.Id === containerId);

      expect(container).not.toBeNull();
      expect(Object.keys(container?.NetworkSettings.Networks ?? {})).toContain(networkName);
    } finally {
      await tester.destroy();
    }
  });

  it('should create a fully ready Redis instance', async () => {
    const Tester = createDefaultTesterBuilder()
      .with(DockerTesterBuilder)
      .with(RedisTesterBuilder)
      .build();

    const tester = new Tester().withRedis();
    try {
      await tester.setup();
      const endpoint = tester.redis.config.endpoints.fromHost;

      expect(endpoint).not.toBeNull();

      // Connect and verify Redis is accessible
      const client: RedisClientType = createClient({ url: endpoint });
      try {
        await client.connect();

        expect(client.isReady).toBe(true);
      } finally {
        if (client.isOpen) await client.disconnect();
      }
    } finally {
      await tester.destroy();
    }
  });

  it('should use custom image when configured', async () => {
    const Tester = createDefaultTesterBuilder()
      .with(DockerTesterBuilder)
      .with(RedisTesterBuilder)
      .build();

    const customImage = 'redis:7-alpine';
    const tester = new Tester().withRedis((builder) => builder.withImage(customImage));
    try {
      await tester.setup();

      expect(tester.redis.config.options.image).toBe(customImage);
    } finally {
      await tester.destroy();
    }
  });

  it('should allow basic Redis operations (SET/GET)', async () => {
    const Tester = createDefaultTesterBuilder()
      .with(DockerTesterBuilder)
      .with(RedisTesterBuilder)
      .build();

    const tester = new Tester().withRedis();
    try {
      await tester.setup();

      const client: RedisClientType = createClient({
        url: tester.redis.config.endpoints.fromHost,
      });
      try {
        await client.connect();

        // Set a value
        await client.set('test-key', 'test-value');

        // Get the value
        const value = await client.get('test-key');
        expect(value).toBe('test-value');
      } finally {
        if (client.isOpen) await client.disconnect();
      }
    } finally {
      await tester.destroy();
    }
  });

  it('should support complex data types (hashes)', async () => {
    const Tester = createDefaultTesterBuilder()
      .with(DockerTesterBuilder)
      .with(RedisTesterBuilder)
      .build();

    const tester = new Tester().withRedis();
    try {
      await tester.setup();

      const client: RedisClientType = createClient({
        url: tester.redis.config.endpoints.fromHost,
      });
      try {
        await client.connect();

        // Set hash values
        await client.hSet('user:1', {
          name: 'John Doe',
          email: 'john@example.com',
          age: '30',
        });

        // Get hash values
        const user = await client.hGetAll('user:1');
        expect(user.name).toBe('John Doe');
        expect(user.email).toBe('john@example.com');
        expect(user.age).toBe('30');
      } finally {
        if (client.isOpen) await client.disconnect();
      }
    } finally {
      await tester.destroy();
    }
  });

  it('should support lists', async () => {
    const Tester = createDefaultTesterBuilder()
      .with(DockerTesterBuilder)
      .with(RedisTesterBuilder)
      .build();

    const tester = new Tester().withRedis();
    try {
      await tester.setup();

      const client: RedisClientType = createClient({
        url: tester.redis.config.endpoints.fromHost,
      });
      try {
        await client.connect();

        // Push to list
        await client.rPush('my-list', ['item1', 'item2', 'item3']);

        // Get list length
        const length = await client.lLen('my-list');
        expect(length).toBe(3);

        // Get all items
        const items = await client.lRange('my-list', 0, -1);
        expect(items).toEqual(['item1', 'item2', 'item3']);
      } finally {
        if (client.isOpen) await client.disconnect();
      }
    } finally {
      await tester.destroy();
    }
  });

  it('should support key expiration', async () => {
    const Tester = createDefaultTesterBuilder()
      .with(DockerTesterBuilder)
      .with(RedisTesterBuilder)
      .build();

    const tester = new Tester().withRedis();
    try {
      await tester.setup();

      const client: RedisClientType = createClient({
        url: tester.redis.config.endpoints.fromHost,
      });
      try {
        await client.connect();

        // Set a key with expiration
        await client.set('expiring-key', 'value', { EX: 1 }); // 1 second expiration

        // Verify it exists
        const value1 = await client.get('expiring-key');
        expect(value1).toBe('value');

        await expect.poll(() => client.get('expiring-key'), { timeout: 3000 }).toBeNull();
      } finally {
        if (client.isOpen) await client.disconnect();
      }
    } finally {
      await tester.destroy();
    }
  });

  it('should support pub/sub', async () => {
    const Tester = createDefaultTesterBuilder()
      .with(DockerTesterBuilder)
      .with(RedisTesterBuilder)
      .build();

    const tester = new Tester().withRedis();
    try {
      await tester.setup();

      // Create publisher and subscriber clients
      const publisher: RedisClientType = createClient({
        url: tester.redis.config.endpoints.fromHost,
      });
      const subscriber: RedisClientType = createClient({
        url: tester.redis.config.endpoints.fromHost,
      });

      try {
        await publisher.connect();
        await subscriber.connect();

        // Track received messages
        const messages: string[] = [];

        // Subscribe to channel
        await subscriber.subscribe('test-channel', (message) => {
          messages.push(message);
        });

        // Publish messages
        await publisher.publish('test-channel', 'message1');
        await publisher.publish('test-channel', 'message2');
        await publisher.publish('test-channel', 'message3');

        await expect.poll(() => messages).toEqual(['message1', 'message2', 'message3']);
      } finally {
        try {
          if (subscriber.isOpen) await subscriber.disconnect();
        } finally {
          if (publisher.isOpen) await publisher.disconnect();
        }
      }
    } finally {
      await tester.destroy();
    }
  });

  it('should use custom network alias', async () => {
    const Tester = createDefaultTesterBuilder()
      .with(DockerTesterBuilder)
      .with(RedisTesterBuilder)
      .build();

    const customAlias = 'my-redis-server';
    const tester = new Tester()
      .withNetwork()
      .withRedis((builder) => builder.withNetworkAlias(customAlias));
    try {
      await tester.setup();

      expect(tester.redis.config.endpoints.networked).toBe(`redis://${customAlias}:6379`);
      const result = await tester.redis.config.container.exec([
        'redis-cli',
        '-u',
        tester.redis.config.endpoints.networked,
        'PING',
      ]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('PONG');
      expect(tester.redis.config.options.networkAlias).toBe(customAlias);
      expect(tester.redis.config.container).toBeDefined();
    } finally {
      await tester.destroy();
    }
  });

  it('should generate correct endpoint format', async () => {
    const Tester = createDefaultTesterBuilder()
      .with(DockerTesterBuilder)
      .with(RedisTesterBuilder)
      .build();

    const tester = new Tester().withRedis();
    try {
      await tester.setup();

      const endpoint = tester.redis.config.endpoints.fromHost;
      expect(endpoint).toBeDefined();
      expect(endpoint).toMatch(/^redis:\/\/.+:\d+$/);
    } finally {
      await tester.destroy();
    }
  });

  it('should remove container on destroy', async () => {
    const Tester = createDefaultTesterBuilder()
      .with(DockerTesterBuilder)
      .with(RedisTesterBuilder)
      .build();

    const tester = new Tester().withRedis();
    let destroyed = false;
    try {
      await tester.setup();
      const containerId = tester.redis.config.container.getId();

      // Verify container exists
      const containersBefore = await docker.listContainers();
      expect(containersBefore.map((x) => x.Id)).toContain(containerId);

      await tester.destroy();
      destroyed = true;

      // Verify container is removed
      const containersAfter = await docker.listContainers();
      expect(containersAfter.map((x) => x.Id)).not.toContain(containerId);
    } finally {
      if (!destroyed) await tester.destroy();
    }
  });

  it('should throw error when accessing config before setup', () => {
    const Tester = createDefaultTesterBuilder()
      .with(DockerTesterBuilder)
      .with(RedisTesterBuilder)
      .build();

    const tester = new Tester().withRedis();

    expect(() => tester.redis.config).toThrow('Redis not initialized');
  });

  it('should handle connection errors gracefully', async () => {
    const Tester = createDefaultTesterBuilder()
      .with(DockerTesterBuilder)
      .with(RedisTesterBuilder)
      .build();

    const tester = new Tester().withRedis();
    try {
      await tester.setup();

      // Create client with wrong URL
      const client: RedisClientType = createClient({
        url: 'redis://invalid-host:6379',
        socket: {
          connectTimeout: 1000,
          reconnectStrategy: false,
        },
      });

      client.on('error', () => {});
      try {
        await expect(client.connect()).rejects.toThrow();
      } finally {
        if (client.isOpen) await client.disconnect();
      }
    } finally {
      await tester.destroy();
    }
  });
});
