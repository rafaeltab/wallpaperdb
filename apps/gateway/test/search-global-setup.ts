import { OpenSearchContainer } from '@wallpaperdb/testcontainers';
import type { TestProject } from 'vitest/node';

/** Own the physical server for this invocation; workers own their indices and clients. */
export default async function setup(project: TestProject) {
  const container = await new OpenSearchContainer('opensearchproject/opensearch:2')
    .withSecurityEnabled(false)
    .start();
  project.provide('gatewaySearch', {
    url: container.getHttpUrl('host'),
    username: container.getUsername(),
    password: container.getPassword(),
  });
  return async () => {
    await container.stop();
  };
}
