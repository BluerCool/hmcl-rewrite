/**
 * Asset index handling: downloading the index document, scheduling object
 * downloads and reconstructing virtual (pre-1.6) layouts — mirroring
 * HMCL's `GameAssetDownloadTask` and `DefaultGameInstance.reconstructAssets`.
 */
import { copyFile, mkdir, readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { DownloadEntry } from '../download/downloader.js';
import { Downloader } from '../download/downloader.js';
import type { DownloadProvider } from '../download/mirrors.js';
import { MOJANG_URLS } from '../download/mirrors.js';
import type { GameRepository } from './repository.js';

/** Content of an asset index document. */
export interface AssetIndex {
  objects: Record<string, { hash: string; size: number }>;
  virtual?: boolean;
  map_to_resources?: boolean;
}

/** Reads a local asset index document if present. */
export async function readAssetIndex(
  repo: GameRepository,
  assetId: string
): Promise<AssetIndex | undefined> {
  try {
    return JSON.parse(await readFile(repo.assetIndexFile(assetId), 'utf8')) as AssetIndex;
  } catch {
    return undefined;
  }
}

/**
 * Ensures the asset index document exists locally.
 *
 * @returns the parsed index plus the URL it was fetched from
 */
export async function ensureAssetIndex(
  repo: GameRepository,
  assetId: string,
  indexUrl: string | undefined,
  provider: DownloadProvider
): Promise<AssetIndex> {
  const existing = await readAssetIndex(repo, assetId);
  if (existing !== undefined) return existing;

  const officialIndexUrl = indexUrl ?? defaultIndexUrl(assetId);
  const url = provider.injectUrl(officialIndexUrl);
  const downloader = new Downloader({ concurrency: provider.concurrency });
  await downloader.downloadOne({
    url,
    destination: repo.assetIndexFile(assetId),
    altUrls: [officialIndexUrl]
  });
  const index = await readAssetIndex(repo, assetId);
  if (index === undefined) {
    throw new Error(`Failed to download asset index "${assetId}"`);
  }
  return index;
}

/**
 * Builds the download entries for every missing asset object of an index.
 */
export async function planAssetObjectDownloads(
  repo: GameRepository,
  index: AssetIndex,
  provider: DownloadProvider
): Promise<DownloadEntry[]> {
  const entries: DownloadEntry[] = [];
  for (const [logicalPath, object] of Object.entries(index.objects)) {
    const target = repo.assetObjectFile(object.hash);
    if (await fileExists(target)) continue;
    const resource = `${object.hash.slice(0, 2)}/${object.hash}`;
    entries.push({
      url: provider.injectUrl(`${provider.assetBaseUrl}${resource}`),
      destination: target,
      sha1: object.hash,
      size: object.size,
      altUrls: [`${MOJANG_URLS.assetBase}${resource}`]
    });
    void logicalPath; // logical path only matters for virtual layouts
  }
  return entries;
}

/**
 * Copies objects into `assets/virtual/<assetId>/` for pre-1.6 versions
 * whose game code expects real resource paths.
 */
export async function reconstructVirtualAssets(
  repo: GameRepository,
  assetId: string,
  index: AssetIndex
): Promise<void> {
  if (index.virtual !== true && index.map_to_resources !== true) return;

  const virtualRoot = repo.virtualAssetsDir(assetId);
  for (const [logicalPath, object] of Object.entries(index.objects)) {
    const source = repo.assetObjectFile(object.hash);
    if (!(await fileExists(source))) continue;
    const target = join(virtualRoot, logicalPath);
    if (await fileExists(target)) continue;
    await mkdir(dirname(target), { recursive: true });
    await copyFile(source, target);
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Hardcoded index URLs for ancient/third-party versions lacking `assetIndex`,
 * mirroring HMCL's fallback table. Hashes are the canonical Mojang documents.
 */
function defaultIndexUrl(assetId: string): string {
  const known: Record<string, string> = {
    legacy: 'https://launchermeta.mojang.com/v1/packages/770572e819335b6c0a053f8378ad88eda189fc14/legacy.json',
    'pre-1.6': 'https://launchermeta.mojang.com/v1/packages/3d8e55480977e32acd9844e545177e69a52f594b/pre-1.6.json'
  };
  return known[assetId] ?? known['legacy']!;
}

export { Downloader };
