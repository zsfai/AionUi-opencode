/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Air-gap policy for app-owned network access.
 *
 * Public internet is blocked unless `AIONUI_ALLOW_NETWORK=1`.
 * Loopback, private LAN, and non-network URLs stay available so local models,
 * the backend, and bundled tools keep working with no internet.
 */

const ALLOW_VALUES = new Set(['1', 'true', 'yes']);

export class OfflineRequestError extends Error {
  readonly url: string;

  constructor(url: string) {
    super(`Offline mode blocked a public network request: ${url}`);
    this.name = 'OfflineRequestError';
    this.url = url;
  }
}

/** True when the process must not contact the public internet. */
export function isAirgapMode(env: NodeJS.ProcessEnv = process.env): boolean {
  const allow = env.AIONUI_ALLOW_NETWORK?.trim().toLowerCase();
  return !allow || !ALLOW_VALUES.has(allow);
}

function stripIpBrackets(hostname: string): string {
  return hostname.replace(/^\[|\]$/g, '').toLowerCase();
}

function isPrivateOrLoopbackHost(hostname: string): boolean {
  const host = stripIpBrackets(hostname);
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host === '0.0.0.0'
  ) {
    return true;
  }

  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (ipv4) {
    const a = Number(ipv4[1]);
    const b = Number(ipv4[2]);
    if ([a, b, Number(ipv4[3]), Number(ipv4[4])].some((part) => part > 255)) return false;
    if (a === 10 || a === 127) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 169 && b === 254) return true;
    return false;
  }

  // Unique-local (fc00::/7) and link-local (fe80::/10). Only real IPv6 literals contain ':'.
  if (host.includes(':')) {
    if (host.startsWith('fc') || host.startsWith('fd')) return true;
    if (/^fe[89ab]/.test(host)) return true;
  }

  return false;
}

/**
 * Whether a URL may be requested while air-gap mode is on.
 * Relative paths and non-network schemes are allowed. Public http(s)/ws(s) hosts are not.
 */
export function isOfflineAllowedUrl(raw: string): boolean {
  const value = raw.trim();
  if (!value) return true;
  if (value.startsWith('//')) return false;
  if (value.startsWith('/') && !value.startsWith('//')) return true;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return true;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:' && url.protocol !== 'ws:' && url.protocol !== 'wss:') {
    return true;
  }

  return isPrivateOrLoopbackHost(url.hostname);
}

export function requestTarget(input: string | URL | Request): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

/** Throws when air-gap mode would send this request to the public internet. */
export function assertOfflineRequestAllowed(input: string | URL | Request, env: NodeJS.ProcessEnv = process.env): void {
  if (!isAirgapMode(env)) return;
  const target = requestTarget(input);
  if (!isOfflineAllowedUrl(target)) {
    throw new OfflineRequestError(target);
  }
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** Wrap a fetch implementation so public hosts are rejected before any socket opens. */
export function guardFetch<T extends FetchLike>(fetchImpl: T, env: NodeJS.ProcessEnv = process.env): T {
  const wrapped: FetchLike = (input, init) => {
    try {
      assertOfflineRequestAllowed(input, env);
    } catch (error) {
      return Promise.reject(error);
    }
    return fetchImpl(input, init);
  };
  return wrapped as T;
}
