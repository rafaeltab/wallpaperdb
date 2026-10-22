import Docker from 'dockerode';
import { connect, type JsMsg, type NatsConnection } from 'nats';
import { describe, expect, it } from 'vitest';
import { createDefaultTesterBuilder, DockerTesterBuilder, NatsTesterBuilder } from '../src/index';

const docker = new Docker();

describe('NatsTesterBuilder', { concurrent: true }, () => {
  it('should create a container', async () => {
    const Tester = createDefaultTesterBuilder()
      .with(DockerTesterBuilder)
      .with(NatsTesterBuilder)
      .build();

    const tester = new Tester().withNats();
    try {
      await tester.setup();
      const containerId = tester.nats.config.container.getContainer().getId();
      const existingContainers = await docker.listContainers();

      expect(existingContainers.map((x) => x.Id)).toContain(containerId);
    } finally {
      await tester.destroy();
    }
  });

  it('should create a container in the correct network', async () => {
    const Tester = createDefaultTesterBuilder()
      .with(DockerTesterBuilder)
      .with(NatsTesterBuilder)
      .build();

    const tester = new Tester().withNetwork().withNats();
    try {
      await tester.setup();
      const networkName = tester.docker.network?.getName();
      const containerId = tester.nats.config.container.getContainer().getId();

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

  it('should create a fully ready NATS instance', async () => {
    const Tester = createDefaultTesterBuilder()
      .with(DockerTesterBuilder)
      .with(NatsTesterBuilder)
      .build();

    const tester = new Tester().withNats();
    try {
      await tester.setup();
      const endpoint = tester.nats.config.endpoints.fromHost;

      expect(endpoint).not.toBeNull();

      // Connect and verify NATS is accessible
      const nc: NatsConnection = await connect({ servers: endpoint });
      try {
        expect(nc.info).toBeDefined();
        expect(nc.isClosed()).toBe(false);
      } finally {
        await nc.close();
      }
    } finally {
      await tester.destroy();
    }
  });

  it('should use custom image when configured', async () => {
    const Tester = createDefaultTesterBuilder()
      .with(DockerTesterBuilder)
      .with(NatsTesterBuilder)
      .build();

    const customImage = 'nats:2.10-alpine';
    const tester = new Tester().withNats((builder) => builder.withImage(customImage));
    try {
      await tester.setup();

      expect(tester.nats.config.options.image).toBe(customImage);
    } finally {
      await tester.destroy();
    }
  });

  it('should enable JetStream when requested', async () => {
    const Tester = createDefaultTesterBuilder()
      .with(DockerTesterBuilder)
      .with(NatsTesterBuilder)
      .build();

    const tester = new Tester().withNats((builder) => builder.withJetstream());
    try {
      await tester.setup();

      expect(tester.nats.config.options.jetStream).toBe(true);

      // Verify JetStream is actually enabled
      const nc: NatsConnection = await connect({
        servers: tester.nats.config.endpoints.fromHost,
      });
      try {
        const jsm = await nc.jetstreamManager();

        // Should be able to list streams without error
        const streams = await jsm.streams.list().next();
        expect(streams).toBeDefined();
      } finally {
        await nc.close();
      }
    } finally {
      await tester.destroy();
    }
  });

  it('should create a stream when requested', async () => {
    const Tester = createDefaultTesterBuilder()
      .with(DockerTesterBuilder)
      .with(NatsTesterBuilder)
      .build();

    const streamName = 'TEST_STREAM';
    const tester = new Tester()
      .withNats((builder) => builder.withJetstream())
      .withStream(streamName);
    try {
      await tester.setup();

      expect(tester.nats.config.streams).toContain(streamName);

      // Verify stream exists
      const nc: NatsConnection = await connect({
        servers: tester.nats.config.endpoints.fromHost,
      });
      try {
        const jsm = await nc.jetstreamManager();

        const streamInfo = await jsm.streams.info(streamName);
        expect(streamInfo.config.name).toBe(streamName);
        expect(streamInfo.config.subjects).toEqual([
          'test_stream.*',
          'test_stream.*.*',
          'test_stream.*.*.*',
          'test_stream.*.*.*.*',
          'test_stream.*.*.*.*.*',
        ]);
      } finally {
        await nc.close();
      }
    } finally {
      await tester.destroy();
    }
  });

  it('should create multiple streams', async () => {
    const Tester = createDefaultTesterBuilder()
      .with(DockerTesterBuilder)
      .with(NatsTesterBuilder)
      .build();

    const tester = new Tester()
      .withNats((builder) => builder.withJetstream())
      .withStream('STREAM_1')
      .withStream('STREAM_2')
      .withStream('STREAM_3');
    try {
      await tester.setup();

      expect(tester.nats.config.streams).toHaveLength(3);
      expect(tester.nats.config.streams).toContain('STREAM_1');
      expect(tester.nats.config.streams).toContain('STREAM_2');
      expect(tester.nats.config.streams).toContain('STREAM_3');

      // Verify all streams exist
      const nc: NatsConnection = await connect({
        servers: tester.nats.config.endpoints.fromHost,
      });
      try {
        const jsm = await nc.jetstreamManager();

        const stream1 = await jsm.streams.info('STREAM_1');
        const stream2 = await jsm.streams.info('STREAM_2');
        const stream3 = await jsm.streams.info('STREAM_3');

        expect(stream1.config.name).toBe('STREAM_1');
        expect(stream2.config.name).toBe('STREAM_2');
        expect(stream3.config.name).toBe('STREAM_3');
      } finally {
        await nc.close();
      }
    } finally {
      await tester.destroy();
    }
  });

  it('should allow publishing to created stream', async () => {
    const Tester = createDefaultTesterBuilder()
      .with(DockerTesterBuilder)
      .with(NatsTesterBuilder)
      .build();

    const streamName = 'PUBLISH_TEST';
    const tester = new Tester()
      .withNats((builder) => builder.withJetstream())
      .withStream(streamName);
    try {
      await tester.setup();

      const nc: NatsConnection = await connect({
        servers: tester.nats.config.endpoints.fromHost,
      });
      try {
        const js = nc.jetstream();

        // Publish a message
        const ack = await js.publish('publish_test.message', JSON.stringify({ test: true }));
        expect(ack.stream).toBe(streamName);
        expect(ack.seq).toBeGreaterThan(0);
      } finally {
        await nc.close();
      }
    } finally {
      await tester.destroy();
    }
  });

  it('should allow subscribing to created stream', async () => {
    const Tester = createDefaultTesterBuilder()
      .with(DockerTesterBuilder)
      .with(NatsTesterBuilder)
      .build();

    const streamName = 'SUBSCRIBE_TEST';
    const tester = new Tester()
      .withNats((builder) => builder.withJetstream())
      .withStream(streamName);
    try {
      await tester.setup();

      const nc: NatsConnection = await connect({
        servers: tester.nats.config.endpoints.fromHost,
      });
      try {
        const js = nc.jetstream();

        // Publish a message
        await js.publish('subscribe_test.message', JSON.stringify({ data: 'test-payload' }));

        // Subscribe using ordered consumer (simpler API)
        const consumer = await js.consumers.get(streamName);
        const messages = await consumer.fetch({ max_messages: 1 });

        const msgs: JsMsg[] = [];
        for await (const msg of messages) {
          msgs.push(msg);
          msg.ack();
        }

        expect(msgs.length).toBe(1);
        expect(JSON.parse(msgs[0].string())).toEqual({ data: 'test-payload' });
      } finally {
        await nc.close();
      }
    } finally {
      await tester.destroy();
    }
  });

  it('should use custom network alias', async () => {
    const Tester = createDefaultTesterBuilder()
      .with(DockerTesterBuilder)
      .with(NatsTesterBuilder)
      .build();

    const customAlias = 'my-nats-server';
    const tester = new Tester()
      .withNetwork()
      .withNats((builder) => builder.withNetworkAlias(customAlias));
    try {
      await tester.setup();

      const result = await tester.nats.config.container
        .getContainer()
        .exec(['wget', '-qO-', '-T', '5', `http://${customAlias}:8222/healthz`]);
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({ status: 'ok' });
      expect(tester.nats.config.endpoints.networked).toBe(`nats://${customAlias}:4222`);
      expect(tester.nats.config.options.networkAlias).toBe(customAlias);
      expect(tester.nats.config.container).toBeDefined();
    } finally {
      await tester.destroy();
    }
  });

  it('should generate correct endpoint format', async () => {
    const Tester = createDefaultTesterBuilder()
      .with(DockerTesterBuilder)
      .with(NatsTesterBuilder)
      .build();

    const tester = new Tester().withNats();
    try {
      await tester.setup();

      const endpoint = tester.nats.config.endpoints.fromHost;
      expect(endpoint).toBeDefined();
      expect(endpoint).toMatch(/^nats:\/\/.+:\d+$/);
    } finally {
      await tester.destroy();
    }
  });

  it('should remove container on destroy', async () => {
    const Tester = createDefaultTesterBuilder()
      .with(DockerTesterBuilder)
      .with(NatsTesterBuilder)
      .build();

    const tester = new Tester().withNats();
    let destroyed = false;
    try {
      await tester.setup();
      const containerId = tester.nats.config.container.getContainer().getId();

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

  it('should have undefined config before setup', () => {
    const Tester = createDefaultTesterBuilder()
      .with(DockerTesterBuilder)
      .with(NatsTesterBuilder)
      .build();

    const tester = new Tester().withNats();

    // The nats helper is always defined, but config should throw before setup
    expect(() => tester.nats.config).toThrow('NATS not initialized');
  });
});
