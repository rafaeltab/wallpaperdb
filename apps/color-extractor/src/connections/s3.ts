import { S3Connection as CoreS3Connection } from '@wallpaperdb/core/connections';
import { inject, singleton } from 'tsyringe';
import type { Config } from '../config.js';

@singleton()
export class S3Connection extends CoreS3Connection {
  constructor(@inject('config') config: Config) {
    super(config);
  }
}
