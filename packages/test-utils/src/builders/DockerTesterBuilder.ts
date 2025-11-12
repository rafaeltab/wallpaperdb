import { Network, RandomUuid, type StartedNetwork } from 'testcontainers';
import { type AddMethodsType, BaseTesterBuilder } from '../framework.js';
import type { SetupTesterBuilder } from './SetupTesterBuilder.js';
import type { DestroyTesterBuilder } from './DestroyTesterBuilder.js';
import { dockerStartSemaphore } from '../utils/semaphore.js';

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
            console.log('Creating Docker network...');

            const network = await new Network(new RandomUuid()).start();

            this.docker.network = network;
            console.log(`Docker network created: ${network.getName()}`);
          });
        });

        this.addDestroyHook(async () => {
          if (this.docker.network) {
            console.log('Stopping Docker network...');
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
