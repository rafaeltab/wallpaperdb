import { randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'dotenv';
import { parseAuthority } from '../src/authority.js';
import { renderBrokerConfiguration } from '../src/adapters/commands/index.js';

const secret = () => randomBytes(32).toString('hex');
const credential = (user: string) => ({ user, password: secret(), revision: '1' });
export async function configureDevelopment(
  root: string,
  options: { readonly issuer: string; readonly ingress: string }
) {
  const path = join(root, 'apps/asset/.authority.json');
  const budget = { maxBytes: 16 * 1024 * 1024, maxMessages: 10000 };
  let existing: string | undefined;
  try {
    existing = await readFile(path, 'utf8');
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  }
  const raw = existing
    ? JSON.parse(existing)
    : {
        revision: 'development-1',
        operatorNotification: {
          url: 'http://asset-operator-inbox:3012/events',
          token: secret(),
          revision: '1',
        },
        broker: {
          service: credential('asset-service'),
          operator: credential('asset-operator'),
          maxAckPending: 32,
          streams: {
            ASSET_COMMANDS: budget,
            ASSET_RESULTS: budget,
            ASSET_QUARANTINE: budget,
            ASSET_OPERATIONS: budget,
          },
        },
        applications: {
          wallpaper: {
            ownerNamespace: 'clerk-development',
            allowedOperations: ['create'],
            allowedTypes: ['wallpaper'],
            credentials: [credential('wallpaper-1')],
          },
          user: {
            ownerNamespace: 'clerk-development',
            allowedOperations: ['create'],
            allowedTypes: ['picture'],
            credentials: [credential('user-1')],
          },
        },
        identityProviders: {
          clerk: {
            adapter: 'clerk',
            ownerNamespace: 'clerk-development',
            issuer: options.issuer,
            jwksUrl: `${options.issuer}/.well-known/jwks.json`,
            tokenProfile: 'session',
            authorizedParties: [options.ingress, options.ingress.replace('localhost', '127.0.0.1')],
            audience: [],
            requireAuthorizedParty: false,
          },
        },
        assetTypes: { wallpaper: {}, picture: {} },
        delivery: { maxAttempts: 3, retryDelayMs: 1000, pollMs: 1000, shutdownTimeoutMs: 5000 },
      };
  let authority = parseAuthority(raw);
  const resolvesPlaceholder =
    authority.identityProviders.clerk?.issuer === 'https://unconfigured.clerk.accounts.dev' &&
    options.issuer !== 'https://unconfigured.clerk.accounts.dev';
  if (resolvesPlaceholder) {
    raw.identityProviders.clerk.issuer = options.issuer;
    raw.identityProviders.clerk.jwksUrl = `${options.issuer}/.well-known/jwks.json`;
    authority = parseAuthority(raw);
  }
  await mkdir(join(root, 'apps/asset'), { recursive: true });
  await mkdir(join(root, 'infra/nats'), { recursive: true });
  if (!existing)
    await writeFile(path, `${JSON.stringify(raw, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  else if (resolvesPlaceholder)
    await writeFile(path, `${JSON.stringify(raw, null, 2)}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
  const brokerPath = join(root, 'infra/nats/.generated.conf');
  await writeFile(brokerPath, renderBrokerConfiguration(authority), { mode: 0o600 });
  await chmod(brokerPath, 0o600);
  return authority.identity;
}
if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const root = resolve('../..');
  const environment = parse(await readFile(join(root, 'apps/user/.env'), 'utf8'));
  const domain = environment.CLERK_DOMAIN?.trim() || 'unconfigured.clerk.accounts.dev';
  const worktree = await readFile(join(root, '.worktree'), 'utf8');
  const port = /^INGRESS_PORT\s*[:?]?=\s*(\d+)/m.exec(worktree)?.[1];
  if (!port) throw new Error('Run worktree setup before generating Asset authority');
  const identity = await configureDevelopment(root, {
    issuer: new URL(domain.startsWith('https://') ? domain : `https://${domain}`).origin,
    ingress: `http://localhost:${port}`,
  });
  process.stdout.write(`Asset development authority ready: ${identity}\n`);
}
