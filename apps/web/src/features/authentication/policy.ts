export function buildAuthUrl(basePath: string, path: string): string {
  return `${basePath}${path.startsWith('/') ? '' : '/'}${path}`.replace(/\/+/g, '/') || '/';
}
export function postAuthDestination(
  url: string,
  hasSessionTask: boolean
): { kind: 'wait' } | { kind: 'route' | 'document'; url: string } {
  if (hasSessionTask) return { kind: 'wait' };
  return { kind: url.startsWith('http') ? 'document' : 'route', url };
}
export function signInNextAction(status: string | null): 'finalize' | 'second-factor' | 'wait' {
  if (status === 'complete') return 'finalize';
  if (status === 'needs_second_factor' || status === 'needs_client_trust') return 'second-factor';
  return 'wait';
}
export function signUpNextAction(status: string | null): 'finalize' | 'send-email-code' | 'wait' {
  if (status === 'complete') return 'finalize';
  if (status === 'missing_requirements') return 'send-email-code';
  return 'wait';
}
