/**
 * Per-instance game settings, mirroring HMCL's
 * `<versionRoot>/.hmcl/config/instance-game-settings.json`.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { GameRepository } from '../game/repository.js';
import type { LaunchOptions } from '../launch/options.js';

/** Process priority levels passed to `nice` on POSIX systems. */
export type ProcessPriority = 'high' | 'above_normal' | 'normal' | 'below_normal' | 'low';

/** Instance-scoped overrides; absent fields inherit global settings. */
export interface InstanceSettings {
  /** When true (default) memory is chosen automatically. */
  autoMemory?: boolean;
  /** Initial heap in MiB. */
  minMemory?: number;
  /** Maximum heap in MiB. */
  maxMemory?: number;
  /** Raw extra JVM arguments string. */
  javaArgs?: string;
  /** `instance` enables version isolation (own saves/configs). */
  gameDirType?: 'global' | 'instance';
  /** Java executable override for this instance. */
  javaExecutable?: string;
  /** Initial window width; enables the custom-resolution feature flag. */
  width?: number;
  /** Initial window height. */
  height?: number;
  /** Launch the game in fullscreen. */
  fullscreen?: boolean;
  /** Server to join after launch (`host` or `host:port`). */
  server?: string;
  /** Raw extra game arguments string, tokenized at launch. */
  gameArguments?: string;
  /** Environment variables in `KEY=VALUE` form, separated by `;` or newlines. */
  environmentVariables?: string;
  /** Process priority for the game process. */
  processPriority?: ProcessPriority;
  /** Wrapper command prefix (e.g. `optirun`). */
  wrapper?: string;
  /** When true, skip HMCL-generated optimizing JVM arguments. */
  noOptimizingJVMArgs?: boolean;
}

/** Path of the per-instance settings file inside the version root. */
export function instanceSettingsPath(repo: GameRepository, versionId: string): string {
  return join(repo.versionRoot(versionId), '.hmcl', 'config', 'instance-game-settings.json');
}

/** Reads the instance settings file; returns `{}` when absent or malformed. */
export async function readInstanceSettings(
  repo: GameRepository,
  versionId: string
): Promise<InstanceSettings> {
  try {
    const raw = await readFile(instanceSettingsPath(repo, versionId), 'utf8');
    const parsed = JSON.parse(raw) as Partial<InstanceSettings>;
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

/** Writes the instance settings file atomically enough for our purposes. */
export async function writeInstanceSettings(
  repo: GameRepository,
  versionId: string,
  settings: InstanceSettings
): Promise<void> {
  const path = instanceSettingsPath(repo, versionId);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(settings, null, 2), 'utf8');
}

/**
 * Splits a JVM argument string into tokens, honouring double-quoted groups
 * like HMCL's tokenizer.
 */
export function tokenizeArguments(raw: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quoted = false;
  for (const character of raw) {
    if (character === '"') {
      quoted = !quoted;
    } else if (character === ' ' && !quoted) {
      if (current !== '') tokens.push(current);
      current = '';
    } else {
      current += character;
    }
  }
  if (current !== '') tokens.push(current);
  return tokens;
}

/**
 * Parses an environment-variable block written as `KEY=VALUE;KEY2=VALUE2`
 * (semicolons or newlines separate entries). Malformed entries are skipped.
 */
export function parseEnvironmentVariables(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  const parts = raw.split(/[;\n]/);
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed === '') continue;
    const index = trimmed.indexOf('=');
    if (index <= 0) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    if (key === '') continue;
    result[key] = value;
  }
  return result;
}

/**
 * Merges effective instance settings into launch options.
 *
 * @param globalMaxMemory fallback from launcher-wide settings
 * @param globalJava fallback java executable
 */
export function applyInstanceSettings(
  options: LaunchOptions,
  settings: InstanceSettings,
  repo: GameRepository,
  versionId: string,
  globalMaxMemory: number | undefined,
  globalJava: string
): LaunchOptions {
  const merged: LaunchOptions = { ...options };

  if (settings.javaExecutable) merged.javaExecutable = settings.javaExecutable;

  // Version isolation: run with the version root as the game directory so
  // saves and configs stay private to this instance.
  if (settings.gameDirType === 'instance') merged.gameDir = repo.versionRoot(versionId);

  const autoMemory = settings.autoMemory ?? true;
  if (!autoMemory) {
    const max = settings.maxMemory ?? globalMaxMemory;
    if (max !== undefined) merged.maxMemory = max;
    if (settings.minMemory !== undefined) merged.minMemory = settings.minMemory;
  }

  const args = settings.javaArgs ? tokenizeArguments(settings.javaArgs) : [];
  if (args.length > 0) {
    merged.jvmArguments = [...(merged.jvmArguments ?? []), ...args];
  }

  // Window sizing: only present when the custom-resolution feature flag is on.
  if (settings.width !== undefined && settings.width > 0) merged.width = settings.width;
  if (settings.height !== undefined && settings.height > 0) merged.height = settings.height;
  if (settings.fullscreen === true) merged.fullscreen = true;

  if (settings.server !== undefined && settings.server.trim() !== '') {
    merged.server = settings.server.trim();
  }

  const gameArgs = settings.gameArguments ? tokenizeArguments(settings.gameArguments) : [];
  if (gameArgs.length > 0) {
    merged.gameArguments = [...(merged.gameArguments ?? []), ...gameArgs];
  }

  if (settings.environmentVariables !== undefined && settings.environmentVariables.trim() !== '') {
    merged.environmentVariables = {
      ...(merged.environmentVariables ?? {}),
      ...parseEnvironmentVariables(settings.environmentVariables)
    };
  }

  if (settings.processPriority !== undefined && settings.processPriority !== 'normal') {
    merged.processPriority = settings.processPriority;
  }

  const wrapper = settings.wrapper?.trim() ?? '';
  if (wrapper !== '') merged.wrapper = wrapper;

  // Opting out of the optimizing flags is only meaningful from an explicit
  // instance override; the global default keeps them on.
  if (settings.noOptimizingJVMArgs === true) merged.noGeneratedOptimizingJVMArgs = true;

  return merged;
}
