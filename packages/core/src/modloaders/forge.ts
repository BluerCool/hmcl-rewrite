/**
 * Forge support: listing promotions via BMCLAPI and installing by running the
 * official installer (`--installClient`) with a local Java — mirroring HMCL's
 * `ForgeInstallTask` behaviour of delegating to the installer itself.
 */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BMCLAPI_ROOT, type DownloadProvider } from '../download/mirrors.js';
import { Downloader, type DownloadProgress } from '../download/downloader.js';
import type { GameRepository } from '../game/repository.js';
import { ensureLauncherProfiles, fileExists, waitForExit } from './internal.js';
import { Launcher } from '../launch/launcher.js';

/** A Forge build advertised for one Minecraft version. */
export interface ForgeBuild {
  /** Installer build number, unique per promotion. */
  readonly build: number;
  /** Forge version, e.g. `51.0.33`. */
  readonly version: string;
  /** Branch suffix when the build was published off the main line. */
  readonly branch: string | undefined;
  /** Whether this is the recommended build for the game version. */
  readonly recommended: boolean;
}

interface BmclapiForgeEntry {
  build?: number;
  version?: string;
  branch?: string;
  mcversion?: string;
  recommended?: boolean | string;
}

/** Lists Forge builds for `mcVersion` (newest first). */
export async function fetchForgeBuilds(mcVersion: string): Promise<ForgeBuild[]> {
  const url = `${BMCLAPI_ROOT}/forge/minecraft/${encodeURIComponent(mcVersion)}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Forge list fetch failed: HTTP ${response.status}`);
  }
  const payload = (await response.json()) as BmclapiForgeEntry[];
  return payload
    .filter((entry) => typeof entry.build === 'number' && typeof entry.version === 'string')
    .map((entry) => ({
      build: entry.build!,
      version: entry.version!,
      branch: entry.branch,
      recommended:
        entry.recommended === true || entry.recommended === 'true' || entry.recommended === 'recommended'
    }))
    .sort((a, b) => b.build - a.build);
}

/** Resolves a listed build by its unique build number. */
export function findBuild(builds: readonly ForgeBuild[], build: number): ForgeBuild {
  const found = builds.find((entry) => entry.build === build);
  if (found === undefined) {
    throw new Error(`Unknown Forge build ${String(build)}`);
  }
  return found;
}

/** The version id the official installer will create in the game directory. */
export function forgeVersionId(mcVersion: string, forgeVersion: string): string {
  return `${mcVersion}-forge-${forgeVersion}`;
}

function installerFilename(mcVersion: string, forgeVersion: string, branch: string | undefined): string {
  const qualifier = branch === undefined ? forgeVersion : `${forgeVersion}-${branch}`;
  return `forge-${mcVersion}-${qualifier}-installer.jar`;
}

async function downloadInstaller(
  provider: DownloadProvider,
  mcVersion: string,
  forgeVersion: string,
  branch: string | undefined,
  build: number
): Promise<string> {
  const filename = installerFilename(mcVersion, forgeVersion, branch);
  // BMCLAPI serves installer artifacts by numeric build id; fall back to
  // Forge's own maven using the canonical file name.
  const candidates = [
    `${BMCLAPI_ROOT}/forge/download/${String(build)}`,
    provider.injectUrl(
      `https://maven.minecraftforge.net/net/minecraftforge/forge/${mcVersion}-${branch === undefined ? forgeVersion : `${forgeVersion}-${branch}`}/${filename}`
    )
  ];

  const target = join(tmpdir(), filename);
  let lastError: unknown = new Error('no candidate URLs');
  for (const url of candidates) {
    try {
      await new Downloader({ concurrency: 4 }).downloadOne({ url, destination: target });
      await stat(target); // throws if nothing was written
      return target;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/**
 * Runs the official Forge installer against the game directory.
 *
 * @returns the created version id (e.g. `1.21-forge-51.0.33`)
 * @throws Error when the installer exits non-zero or produces no version
 */
export async function installForgeVersion(
  repo: GameRepository,
  provider: DownloadProvider,
  mcVersion: string,
  forgeVersion: string,
  branch: string | undefined,
  build: number,
  javaExecutable: string,
  onLine?: (line: string) => void,
  onProgress?: (progress: DownloadProgress) => void,
  onStage?: (stage: string) => void
): Promise<string> {
  onStage?.('resolving');
  if (!(await stat(repo.versionJson(mcVersion)).then(() => true, () => false))) {
    throw new Error(`Vanilla ${mcVersion} is not installed; install it first`);
  }

  // The official installer refuses to run unless the directory looks like a
  // launcher profile store; real launchers always provide one (HMCL does too).
  await ensureLauncherProfiles(repo);

  const installer = await downloadInstaller(provider, mcVersion, forgeVersion, branch, build);
  onLine?.(`>>> 运行安装器: ${installer}`);

  const child = spawn(javaExecutable, ['-jar', installer, '--installClient', repo.rootDir], {
    cwd: repo.rootDir,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  for (const stream of [child.stdout, child.stderr]) {
    if (stream === null) continue;
    createInterface({ input: stream }).on('line', (line) => onLine?.(line));
  }
  const exitCode = await waitForExit(child);

  const id = forgeVersionId(mcVersion, forgeVersion);
  if (exitCode !== 0 || !(await fileExists(repo.versionJson(id)))) {
    throw new Error(`Forge installer failed (exit ${String(exitCode)})`);
  }
  onStage?.('downloading-libraries');
  await new Launcher(repo, provider).ensureGameFiles(await repo.resolveInstalledVersion(id), undefined);
  onStage?.('downloading-assets');
  onStage?.('finished');
  return id;
}
