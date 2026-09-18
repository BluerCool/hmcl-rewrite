/**
 * OptiFine support via the BMCLAPI mirror.
 *
 * The official OptiFine installer has no documented CLI, but empirically
 * `optifine.Installer --quiet` performs a headless install into
 * `Utils.getWorkingDirectory()`, which on Linux resolves `${user.home}/.minecraft`.
 * We therefore run it with `-Duser.home=<parent of game dir>` so it installs
 * into the repository (which follows the standard `.minecraft` layout).
 */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { BMCLAPI_ROOT, type DownloadProvider } from '../download/mirrors.js';
import { Downloader, type DownloadProgress } from '../download/downloader.js';
import { GameRepository } from '../game/repository.js';
import { fileExists, waitForExit } from './internal.js';
import { Launcher } from '../launch/launcher.js';

/** An OptiFine build advertised for one Minecraft version. */
export interface OptiFineBuild {
  /** Edition type without spaces, e.g. `HD_U_J1`. */
  readonly type: string;
  /** Patch suffix, e.g. `pre9` or empty for stable builds. */
  readonly patch: string;
  /** False for `preview_*` files. */
  readonly stable: boolean;
}

interface BmclapiOptifineEntry {
  mcversion?: string;
  type?: string;
  patch?: string;
  filename?: string;
}

/** Lists OptiFine builds for `mcVersion` (BMCLAPI order, oldest first). */
export async function fetchOptiFineBuilds(mcVersion: string): Promise<OptiFineBuild[]> {
  const response = await fetch(`${BMCLAPI_ROOT}/optifine/${encodeURIComponent(mcVersion)}`);
  if (!response.ok) {
    throw new Error(`OptiFine list fetch failed: HTTP ${response.status}`);
  }
  const payload = (await response.json()) as BmclapiOptifineEntry[];
  return payload.flatMap((entry) => {
    if (entry.type === undefined || entry.patch === undefined) return [];
    return [
      {
        type: entry.type,
        patch: entry.patch,
        stable: !(entry.filename ?? '').startsWith('preview')
      }
    ];
  });
}

/** Opaque loader id encoding for an OptiFine build. */
export function optiFineLoaderId(build: OptiFineBuild): string {
  return `${build.type}/${build.patch}`;
}

/** Parses an opaque id produced by {@link optiFineLoaderId}. */
export function parseOptiFineLoaderId(id: string): { type: string; patch: string } {
  const slash = id.indexOf('/');
  if (slash < 0) throw new Error(`Invalid OptiFine id "${id}"`);
  return { type: id.slice(0, slash), patch: id.slice(slash + 1) };
}

/** The version id the installer creates (`<mc>-OptiFine_<type>_<patch>`). */
export function optiFineVersionId(mcVersion: string, type: string, patch: string): string {
  const suffix = patch === '' ? '' : `_${patch}`;
  return `${mcVersion}-OptiFine_${type}${suffix}`;
}

/**
 * Downloads the OptiFine installer from BMCLAPI and runs it headlessly.
 *
 * @returns the created version id (e.g. `1.21-OptiFine_HD_U_J1_pre9`)
 */
export async function installOptiFineVersion(
  repo: GameRepository,
  provider: DownloadProvider,
  mcVersion: string,
  type: string,
  patch: string,
  javaExecutable: string,
  onLine?: (line: string) => void,
  onProgress?: (progress: DownloadProgress) => void,
  onStage?: (stage: string) => void
): Promise<string> {
  onStage?.('resolving');
  if (!(await fileExists(repo.versionJson(mcVersion)))) {
    throw new Error(`Vanilla ${mcVersion} is not installed; install it first`);
  }

  // The OptiFine layout trick requires the default `.minecraft` directory name.
  if (repo.rootDir.split('/').pop() !== '.minecraft') {
    throw new Error('OptiFine 安装要求游戏目录名为 .minecraft');
  }

  const installer = join(tmpdir(), `OptiFine_${mcVersion}_${type}_${patch}.jar`);
  const url = `${BMCLAPI_ROOT}/optifine/${encodeURIComponent(mcVersion)}/${type}/${patch}`;
  onLine?.(`>>> 下载 OptiFine ${type} ${patch}`);
  await new Downloader({ concurrency: 2 }).downloadOne({ url, destination: installer });

  // `-Duser.home` redirects getWorkingDirectory() to our repository.
  const child = spawn(
    javaExecutable,
    [`-Duser.home=${dirname(repo.rootDir)}`, '-cp', installer, 'optifine.Installer', '--quiet'],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );
  for (const stream of [child.stdout, child.stderr]) {
    if (stream === null) continue;
    createInterface({ input: stream }).on('line', (line) => onLine?.(line));
  }

  const exitCode = await waitForExit(child);
  const id = optiFineVersionId(mcVersion, type, patch);
  if (exitCode !== 0 || !(await fileExists(repo.versionJson(id)))) {
    throw new Error(`OptiFine installer failed (exit ${String(exitCode)})`);
  }
  onStage?.('downloading-libraries');
  await new Launcher(repo, provider).ensureGameFiles(await repo.resolveInstalledVersion(id), undefined);
  onStage?.('downloading-assets');
  onStage?.('finished');
  return id;
}
