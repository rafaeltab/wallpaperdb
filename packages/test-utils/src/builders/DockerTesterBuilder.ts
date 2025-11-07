import { Network, type StartedNetwork } from 'testcontainers';
import { type AddMethodsType, BaseTesterBuilder } from '../framework.js';

export interface DockerConfig {
  network?: StartedNetwork;
}

export class DockerTesterBuilder extends BaseTesterBuilder<'docker', []> {
  name = 'docker' as const;

  addMethods<TBase extends AddMethodsType<[]>>(Base: TBase) {
    return class Docker extends Base {
      docker: DockerConfig = {};

      withNetwork() {
        this.addSetupHook(async () => {
          console.log('Creating Docker network...');

          const network = await new Network().start();

          this.docker.network = network;
          console.log(`Docker network created: ${network.getName()}`);
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
