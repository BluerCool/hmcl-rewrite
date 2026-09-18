/**
 * Shared helpers for mod-loader installers (Forge/NeoForge family).
 */
import { stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { GameRepository } from '../game/repository.js';

/**
 * Ensures the game directory contains a minimal `launcher_profiles.json`.
 * Official Forge/NeoForge installers refuse to run without one.
 */
export async function ensureLauncherProfiles(repo: GameRepository): Promise<void> {
  const profilesPath = join(repo.rootDir, 'launcher_profiles.json');
  if (!(await stat(profilesPath).then(() => true, () => false))) {
    await writeFile(
      profilesPath,
      JSON.stringify({ profiles: {}, settings: {}, version: 3 }),
      'utf8'
    );
  }
}

/** Waits for a spawned process and resolves its exit code. */
export function waitForExit(
  child: import('node:child_process').ChildProcess
): Promise<number> {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? -1));
  });
}

/** True when `path` exists. */
export async function fileExists(path: string): Promise<boolean> {
  return stat(path)
    .then(() => true)
    .catch(() => false);
}
