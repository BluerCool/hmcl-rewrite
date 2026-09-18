/**
 * Vanilla game installation: fetch the manifest profile and ensure every
 * file required to run it is present — the core counterpart of the main
 * process `versions:install` handler.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import type { DownloadProgress } from '../download/downloader.js';
import type { DownloadProvider } from '../download/mirrors.js';
import type { GameRepository } from '../game/repository.js';
import { Launcher } from '../launch/launcher.js';

/**
 * Conveniently downloads the manifest profile for `id` and stores it as an
 * installed version, then prefetches its libraries/assets.
 *
 * @throws Error when the manifest does not advertise the version
 */
export async function installVanillaVersion(
  repo: GameRepository,
  provider: DownloadProvider,
  id: string,
  onProgress?: (progress: DownloadProgress) => void,
  onStage?: (stage: string) => void
): Promise<void> {
  onStage?.('resolving');
  const versionRoot = repo.versionRoot(id);
  await mkdir(versionRoot, { recursive: true });
  await writeFile(
    repo.versionJson(id),
    JSON.stringify(await fetchManifestProfile(provider, id), null, 2),
    'utf8'
  );

  const resolved = await repo.resolveInstalledVersion(id);
  onStage?.('downloading-libraries');
  await new Launcher(repo, provider).ensureGameFiles(resolved, onProgress);
  onStage?.('downloading-assets');
  onStage?.('finished');
}

/** Resolves and downloads the manifest JSON profile of a remote version. */
export async function fetchManifestProfile(
  provider: DownloadProvider,
  id: string
): Promise<Record<string, unknown>> {
  const response = await fetch(provider.injectUrl(await remoteVersionManifestUrl(provider, id)));
  if (!response.ok) {
    throw new Error(`Version fetch failed: HTTP ${response.status}`);
  }
  return (await response.json()) as Record<string, unknown>;
}

/** Finds the manifest profile URL for `id` in the version manifest. */
export async function remoteVersionManifestUrl(
  provider: DownloadProvider,
  id: string
): Promise<string> {
  const response = await fetch(provider.versionManifestUrl);
  if (!response.ok) throw new Error(`Manifest fetch failed: HTTP ${response.status}`);
  const manifest = (await response.json()) as {
    versions: { id: string; url: string }[];
  };
  const entry = manifest.versions.find((version) => version.id === id);
  if (entry === undefined) throw new Error(`Unknown version "${id}"`);
  return entry.url;
}