import { lookup } from 'node:dns/promises';

/**
 * Determine if a host is already an IPv4 address.
 */
function isIPv4Literal(host: string): boolean {
  // Fast path for IPv4
  const ipv4Regex = /^(?:25[0-5]|2[0-4]\d|1?\d{1,2})(?:\.(?:25[0-5]|2[0-4]\d|1?\d{1,2})){3}$/;
  return ipv4Regex.test(host);
}

function isBareDomain(input: string): boolean {
  if (typeof input !== 'string') return false;
  const s = input.trim();
  if (s.length === 0) return false;

  if (/[:/?#@\s]/u.test(s) || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(s)) {
    return false;
  }

  if (s.endsWith('.')) return false;

  const labels = s.split('.');

  // Allow single-label names like "localhost"
  if (labels.some((l) => l.length === 0)) return false;
  if (s.length > 253) return false;

  if (
    /^\d{1,3}(\.\d{1,3}){3}$/.test(s) &&
    s.split('.').every((octet) => Number(octet) >= 0 && Number(octet) <= 255)
  ) {
    return false;
  }

  const labelRegex = /^[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?$/u;

  for (const label of labels) {
    if (label.length < 1 || label.length > 63) return false;
    if (!labelRegex.test(label)) return false;
    if (label.startsWith('-') || label.endsWith('-')) return false;
  }

  // Optional: keep TLD numeric restriction only when there are 2+ labels
  if (labels.length >= 2) {
    const tld = labels[labels.length - 1];
    if (/^\d+$/.test(tld)) return false;
  }

  return true;
}
export async function resolveUrlIpv4(url: string): Promise<string> {
  if (isIPv4Literal(url)) return url;
  if (isBareDomain(url)) {
    const address = await lookup(url, { family: 4 });
    return address.address;
  }

  const uri = new URL(url);
  const hostName = uri.hostname;

  const address = await lookup(hostName, { family: 4 });
  uri.hostname = address.address;
  return uri.toString();
}
