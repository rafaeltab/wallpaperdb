import { NatsConnectionManager as CoreNatsConnectionManager } from '@wallpaperdb/core/connections';
import { inject, singleton } from 'tsyringe';
import type { Config } from '../config.js';

@singleton()
export class NatsConnectionManager extends CoreNatsConnectionManager {
  constructor(@inject('config') config: Config) {
    super({
      natsUrl: config.natsUrl,
      serviceName: config.otelServiceName,
    });
  }
}
