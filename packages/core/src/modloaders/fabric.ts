/**
 * Fabric loader support: listing loader builds for a game version and
 * generating the launcher profile via the official Fabric meta API —
 * mirroring HMCL's `FabricAPIInstallTask`/`FabricInstallTask`.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import type { DownloadProvider } from '../download/mirrors.js';
import { Downloader, type DownloadProgress } from '../download/downloader.js';
import type { GameRepository } from '../game/repository.js';
import type { GameVersionJson } from '../version/types.js';
import { Launcher } from '../launch/launcher.js';

const FABRIC_META = 'https://meta.fabricmc.net';

/** A Fabric loader build advertised for (or independent of) a game version. */
export interface FabricLoaderEntry {
  /** Loader version string, e.g. `0.16.14`. */
  readonly version: string;
  readonly stable: boolean;
}

interface FabricMetaResponse {
  loader?: { version?: string; stable?: boolean };
}

/**
 * Lists Fabric loader versions compatible with `mcVersion`.
 *
 * @returns loader entries, newest first
 */
export async function fetchFabricLoaders(
  provider: DownloadProvider,
  mcVersion: string
): Promise<FabricLoaderEntry[]> {
  const url = provider.injectUrl(`${FABRIC_META}/v2/versions/loader/${encodeURIComponent(mcVersion)}`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Fabric meta fetch failed: HTTP ${response.status}`);
  }
  const payload = (await response.json()) as FabricMetaResponse[];
  return payload.flatMap((entry) => {
    if (entry.loader?.version === undefined) return [];
    return [{ version: entry.loader.version, stable: entry.loader.stable === true }];
  });
}

/**
 * Fetches the launcher profile for `loaderVersion` on `mcVersion` and stores
 * it as an installed version. The profile inherits from the vanilla version,
 * so the existing resolve/download pipeline handles everything else.
 *
 * @returns the created version id (e.g. `fabric-loader-0.16.14-1.21`)
 */
export async function installFabricVersion(
  repo: GameRepository,
  provider: DownloadProvider,
  mcVersion: string,
  loaderVersion: string,
  onProgress?: (progress: DownloadProgress) => void,
  onStage?: (stage: string) => void
): Promise<string> {
  onStage?.('resolving');
  const base = `${FABRIC_META}/v2/versions/loader/${encodeURIComponent(mcVersion)}/${encodeURIComponent(loaderVersion)}/profile/json`;
  const response = await fetch(provider.injectUrl(base));
  if (!response.ok) {
    throw new Error(`Fabric profile fetch failed: HTTP ${response.status}`);
  }
  const profile = (await response.json()) as GameVersionJson;
  if (!profile.inheritsFrom || !profile.mainClass || typeof profile.id !== 'string') {
    throw new Error('Fabric meta returned an unusable profile');
  }

  const root = repo.versionRoot(profile.id);
  await mkdir(root, { recursive: true });
  await writeFile(repo.versionJson(profile.id), JSON.stringify(profile, null, 2), 'utf8');
  onStage?.('downloading-libraries');
  await new Launcher(repo, provider).ensureGameFiles(await repo.resolveInstalledVersion(profile.id), onProgress);
  onStage?.('downloading-assets');
  onStage?.('finished');
  return profile.id;
}
