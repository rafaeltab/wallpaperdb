import Docker from 'dockerode';
import { describe, expect, it } from 'vitest';
import { createDefaultTesterBuilder, DockerTesterBuilder } from '../src/index';

const docker = new Docker();

describe('DockerTesterBuilder', { concurrent: true }, () => {
  it('should start a network when needed', async () => {
    const Tester = createDefaultTesterBuilder().with(DockerTesterBuilder).build();

    // Act
    const tester = new Tester().withNetwork();
    try {
      await tester.setup();
      const networkName = tester.docker.network?.getName();
      const existingNetworks = await docker.listNetworks();

      // Assert
      expect(existingNetworks.map((x) => x.Name)).toContain(networkName);
    } finally {
      await tester.destroy();
    }
  });

  it('should remove network on destroy', async () => {
    const Tester = createDefaultTesterBuilder().with(DockerTesterBuilder).build();

    // Setup
    const tester = new Tester().withNetwork();
    let destroyed = false;
    try {
      await tester.setup();
      const networkName = tester.docker.network?.getName();

      // Verify network exists
      const networksBeforeDestroy = await docker.listNetworks();
      expect(networksBeforeDestroy.map((x) => x.Name)).toContain(networkName);

      // Destroy
      await tester.destroy();
      destroyed = true;

      // Verify network is removed
      const networksAfterDestroy = await docker.listNetworks();
      expect(networksAfterDestroy.map((x) => x.Name)).not.toContain(networkName);
    } finally {
      if (!destroyed) await tester.destroy();
    }
  });

  it('should have undefined network before setup', () => {
    const Tester = createDefaultTesterBuilder().with(DockerTesterBuilder).build();
    const tester = new Tester().withNetwork();

    expect(tester.docker.network).toBeUndefined();
  });

  it('should create isolated networks for multiple testers', async () => {
    const Tester = createDefaultTesterBuilder().with(DockerTesterBuilder).build();

    // Create two separate testers
    const tester1 = new Tester().withNetwork();
    try {
      await tester1.setup();
      const tester2 = new Tester().withNetwork();
      try {
        await tester2.setup();

        const network1Name = tester1.docker.network?.getName();
        const network2Name = tester2.docker.network?.getName();

        // Networks should be different
        expect(network1Name).not.toBe(network2Name);

        // Both should exist
        const existingNetworks = await docker.listNetworks();
        const networkNames = existingNetworks.map((x) => x.Name);
        expect(networkNames).toContain(network1Name);
        expect(networkNames).toContain(network2Name);
      } finally {
        await tester2.destroy();
      }
    } finally {
      await tester1.destroy();
    }
  });

  it('should handle setup without network', async () => {
    const Tester = createDefaultTesterBuilder().with(DockerTesterBuilder).build();

    // Setup without calling withNetwork()
    const tester = new Tester();
    try {
      await tester.setup();

      // Network should be undefined
      expect(tester.docker.network).toBeUndefined();
    } finally {
      await tester.destroy();
    }
  });

  it.each([
    'setup',
    'assertion',
  ])('releases the owned network after a %s failure', async (phase) => {
    const Tester = createDefaultTesterBuilder().with(DockerTesterBuilder).build();
    const tester = new Tester().withNetwork();
    const failure = new Error(`deliberate ${phase} failure`);
    let networkId: string | undefined;
    if (phase === 'setup') {
      tester.addSetupHook(async () => {
        throw failure;
      });
    }
    const exercise = async () => {
      try {
        await tester.setup();
        throw failure;
      } finally {
        networkId = tester.docker.network?.getId();
        await tester.destroy();
      }
    };

    await expect(exercise()).rejects.toBe(failure);
    expect(networkId).toEqual(expect.any(String));
    expect((await docker.listNetworks()).map((network) => network.Id)).not.toContain(networkId);
  });
});
