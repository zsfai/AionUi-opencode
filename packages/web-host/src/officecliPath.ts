/**
 * Resolve the vendored officecli binary and put it on PATH.
 *
 * aioncore looks up `officecli` / `officecli.exe` on PATH before it tries the
 * network installer. Prepending the bundled directory keeps preview and document
 * tools on the local binary.
 */

import { existsSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';

const ALLOW_VALUES = new Set(['1', 'true', 'yes']);

export type OfficecliLookup = {
  env?: NodeJS.ProcessEnv;
  resourcesPath?: string;
  cwd?: string;
  execPath?: string;
  platform?: NodeJS.Platform;
  arch?: string;
  exists?: (filePath: string) => boolean;
};

export function officecliBinaryName(platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? 'officecli.exe' : 'officecli';
}

function isAirgap(env: NodeJS.ProcessEnv): boolean {
  const allow = env.AIONUI_ALLOW_NETWORK?.trim().toLowerCase();
  return !allow || !ALLOW_VALUES.has(allow);
}

/**
 * Directory that contains the platform officecli binary, or null when it is not vendored.
 */
export function findBundledOfficecliDir(options: OfficecliLookup = {}): string | null {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const exists = options.exists ?? existsSync;
  const cwd = options.cwd ?? process.cwd();
  const execPath = options.execPath ?? process.execPath;
  const resourcesPath =
    options.resourcesPath ?? (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  const runtimeKey = `${platform}-${arch}`;
  const binaryName = officecliBinaryName(platform);
  const execDir = dirname(execPath);

  const candidates = [
    env.AIONUI_OFFICECLI_DIR,
    resourcesPath ? join(resourcesPath, 'bundled-officecli', runtimeKey) : undefined,
    join(cwd, 'resources', 'bundled-officecli', runtimeKey),
    join(cwd, 'bundled-officecli', runtimeKey),
    join(execDir, 'bundled-officecli', runtimeKey),
    join(execDir, 'resources', 'bundled-officecli', runtimeKey),
  ].filter((dir): dir is string => Boolean(dir));

  for (const dir of candidates) {
    if (exists(join(dir, binaryName))) return dir;
  }
  return null;
}

/**
 * Copy of `env` with the bundled officecli directory first on PATH.
 * Sets `AIONUI_OFFLINE=1` while air-gap mode is on.
 */
export function withBundledOfficecli(env: NodeJS.ProcessEnv, options: OfficecliLookup = {}): NodeJS.ProcessEnv {
  const next: NodeJS.ProcessEnv = { ...env };
  const dir = findBundledOfficecliDir({ ...options, env: next });
  if (isAirgap(next) && next.AIONUI_OFFLINE === undefined) {
    next.AIONUI_OFFLINE = '1';
  }
  if (!dir) return next;

  const current = next.PATH || next.Path || '';
  const parts = current.split(delimiter).filter(Boolean);
  const alreadyPresent = parts.some((part) => part.toLowerCase() === dir.toLowerCase());
  if (!alreadyPresent) {
    const merged = [dir, ...parts].join(delimiter);
    next.PATH = merged;
    next.Path = merged;
  }
  next.AIONUI_OFFICECLI_DIR = dir;
  return next;
}

/** Mutate the current process env so later child processes inherit the bundled binary. */
export function applyBundledOfficecliToProcess(options: OfficecliLookup = {}): string | null {
  const next = withBundledOfficecli(process.env, options);
  if (next.PATH) process.env.PATH = next.PATH;
  if (next.Path) process.env.Path = next.Path;
  if (next.AIONUI_OFFICECLI_DIR) process.env.AIONUI_OFFICECLI_DIR = next.AIONUI_OFFICECLI_DIR;
  if (next.AIONUI_OFFLINE && process.env.AIONUI_OFFLINE === undefined) {
    process.env.AIONUI_OFFLINE = next.AIONUI_OFFLINE;
  }
  return next.AIONUI_OFFICECLI_DIR ?? null;
}
