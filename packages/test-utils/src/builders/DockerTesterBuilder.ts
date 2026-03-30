import { Network, RandomUuid, type StartedNetwork } from 'testcontainers';
import { type AddMethodsType, BaseTesterBuilder } from '../framework.js';
import type { SetupTesterBuilder } from './SetupTesterBuilder.js';
import type { DestroyTesterBuilder } from './DestroyTesterBuilder.js';
import { dockerStartSemaphore } from '../utils/semaphore.js';
import { createTestLogger } from '@wallpaperdb/test-logger';

const logger = createTestLogger('DockerTesterBuilder');

export interface DockerConfig {
  network?: StartedNetwork;
}

export class DockerTesterBuilder extends BaseTesterBuilder<
  'docker',
  [SetupTesterBuilder, DestroyTesterBuilder]
> {
  name = 'docker' as const;

  addMethods<TBase extends AddMethodsType<[SetupTesterBuilder, DestroyTesterBuilder]>>(
    Base: TBase
  ) {
    return class Docker extends Base {
      docker: DockerConfig = {};

      withNetwork() {
        this.addSetupHook(async () => {
          // Use semaphore to limit concurrent network creation
          await dockerStartSemaphore.run(async () => {
            logger.debug('Creating Docker network...');

            const network = await new Network(new RandomUuid()).start();

            this.docker.network = network;
            logger.debug({ name: network.getName() }, 'Docker network created');
          });
        });

        this.addDestroyHook(async () => {
          if (this.docker.network) {
            logger.debug('Stopping Docker network...');
            await this.docker.network.stop();
          }
        });

        return this;
      }

      getNetwork(): StartedNetwork {
        if (!this.docker.network) {
          throw new Error('Docker network not initialized. Call withNetwork() and setup() first.');
        }
        return this.docker.network;
      }
    };
  }
}
