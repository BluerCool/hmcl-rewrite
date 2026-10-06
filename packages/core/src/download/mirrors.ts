/**
 * Download providers mirroring HMCL's `MojangDownloadProvider` and
 * `BMCLAPIDownloadProvider`: source-of-truth URLs plus mirror rewriting.
 */
import { cpus } from 'node:os';

/** Official Mojang endpoints. */
export const MOJANG_URLS = {
  versionManifest: 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json',
  legacyVersionManifest: 'https://piston-meta.mojang.com/mc/game/version_manifest.json',
  assetBase: 'https://resources.download.minecraft.net/',
  libraryBase: 'https://libraries.minecraft.net/'
} as const;

/** Default BMCLAPI root used by HMCL. */
export const BMCLAPI_ROOT = 'https://bmclapi2.bangbang93.com';

/** Mirror serving Modrinth file downloads when cdn.modrinth.com is blocked. */
export const MODRINTH_MIRROR_ROOT = 'https://mod.mcimirror.top';

/**
 * Concurrency for 自动选择线程数: the mirror scales with the machine, while the
 * official source stays at a fixed 6.
 */
const autoConcurrency = (): number => Math.max(cpus().length * 2, 6);

/** Concurrency the official provider uses; it is not CPU-derived. */
const MOJANG_CONCURRENCY = 6;

/**
 * Where a URL is fetched from, HMCL's `DownloadSource` minus `DEFAULT`: picking
 * the fastest source by probing is something we do not do.
 */
export type DownloadSource = 'mojang' | 'bmclapi';

/**
 * A download provider decides where version lists live, how asset objects
 * are fetched and how arbitrary Mojang URLs are rewritten onto a mirror.
 */
export interface DownloadProvider {
  /** Remote version manifest URL. */
  readonly versionManifestUrl: string;
  /** Base URL for asset objects (`<base><prefix2>/<hash>`). */
  readonly assetBaseUrl: string;
  /** Default maven repository for libraries without explicit URLs. */
  readonly libraryBaseUrl: string;
  /** Concurrent download limit. */
  readonly concurrency: number;
  /** Rewrites an official URL onto this provider's mirror when possible. */
  injectUrl(url: string): string;
  /**
   * Fallback URLs for a file download, tried after the primary URL when it
   * fails. Empty when the provider offers no mirror for this URL.
   */
  altUrls(url: string): readonly string[];
}

/** Official Mojang infrastructure; URLs pass through unchanged. */
export class MojangDownloadProvider implements DownloadProvider {
  readonly versionManifestUrl = MOJANG_URLS.versionManifest;
  readonly assetBaseUrl = MOJANG_URLS.assetBase;
  readonly libraryBaseUrl = MOJANG_URLS.libraryBase;
  readonly concurrency: number;

  /** `concurrency` overrides the default of 6 (HMCL 下载 → 下载线程数). */
  constructor(concurrency: number = MOJANG_CONCURRENCY) {
    this.concurrency = concurrency;
  }

  injectUrl(url: string): string {
    return url;
  }

  altUrls(_url: string): readonly string[] {
    return [];
  }
}

/**
 * BMCLAPI mirror. Rewrites every official endpoint prefix onto the mirror
 * root using the same mapping table as HMCL, and offers Modrinth CDN files
 * an alternate mirror host (the mirror is unreachable on some networks).
 */
export class BmclapiDownloadProvider implements DownloadProvider {
  readonly apiRoot: string;
  readonly modrinthMirrorRoot: string;
  readonly versionManifestUrl: string;
  readonly assetBaseUrl: string;
  readonly libraryBaseUrl: string;
  readonly concurrency: number;

  /**
   * `concurrency` overrides the default of twice the core count, i.e. what
   * HMCL labels 自动选择线程数.
   */
  constructor(
    apiRoot: string = BMCLAPI_ROOT,
    modrinthMirrorRoot: string = MODRINTH_MIRROR_ROOT,
    concurrency: number = autoConcurrency()
  ) {
    this.apiRoot = apiRoot.replace(/\/$/, '');
    this.modrinthMirrorRoot = modrinthMirrorRoot.replace(/\/$/, '');
    this.versionManifestUrl = `${this.apiRoot}/mc/game/version_manifest_v2.json`;
    this.assetBaseUrl = `${this.apiRoot}/assets/`;
    this.libraryBaseUrl = `${this.apiRoot}/maven/`;
    this.concurrency = concurrency;
  }

  private static readonly REPLACEMENTS: readonly (readonly [string, (root: string) => string])[] = [
    ['https://bmclapi2.bangbang93.com', (root) => root],
    ['https://launchermeta.mojang.com', (root) => root],
    ['https://piston-meta.mojang.com', (root) => root],
    ['https://piston-data.mojang.com', (root) => root],
    ['https://launcher.mojang.com', (root) => root],
    ['https://libraries.minecraft.net', (root) => `${root}/libraries`],
    ['https://maven.minecraftforge.net', (root) => `${root}/maven`],
    ['http://files.minecraftforge.net/maven', (root) => `${root}/maven`],
    ['https://files.minecraftforge.net/maven', (root) => `${root}/maven`],
    ['https://maven.neoforged.net/releases', (root) => `${root}/maven`],
    ['https://meta.fabricmc.net', (root) => `${root}/fabric-meta`],
    ['https://maven.fabricmc.net', (root) => `${root}/maven`]
  ];

  /** Modrinth hosts served by the Modrinth mirror instead of the BMCLAPI root. */
  private static readonly MODRINTH_REPLACEMENTS: readonly (readonly [string, string])[] = [
    ['https://cdn.modrinth.com', ''],
    ['https://api.modrinth.com', '/modrinth']
  ];

  injectUrl(url: string): string {
    for (const [prefix, rewrite] of BmclapiDownloadProvider.REPLACEMENTS) {
      if (url.startsWith(prefix)) {
        return rewrite(this.apiRoot) + url.slice(prefix.length);
      }
    }
    for (const [prefix, suffix] of BmclapiDownloadProvider.MODRINTH_REPLACEMENTS) {
      if (url.startsWith(prefix)) {
        return this.modrinthMirrorRoot + suffix + url.slice(prefix.length);
      }
    }
    return url;
  }

  altUrls(url: string): readonly string[] {
    // Modrinth files keep the original CDN URL as primary and add the mirror
    // as a fallback; official URLs are already fully rewritten by `injectUrl`,
    // so no additional candidates exist.
    for (const [prefix, suffix] of BmclapiDownloadProvider.MODRINTH_REPLACEMENTS) {
      if (url.startsWith(prefix)) {
        return [this.modrinthMirrorRoot + suffix + url.slice(prefix.length)];
      }
    }
    return [];
  }
}

/**
 * Answers the manifest from one provider and everything file-related from
 * another, so 版本列表源 and 文件下载源 can differ — the mirror can serve the
 * version list while the actual files still come straight from Mojang.
 *
 * Only the manifest is a genuine list concern; the file-facing members all
 * belong to whichever source the bytes come from.
 */
export class RoutedDownloadProvider implements DownloadProvider {
  constructor(
    private readonly lists: DownloadProvider,
    private readonly files: DownloadProvider
  ) {}

  get versionManifestUrl(): string {
    return this.lists.versionManifestUrl;
  }

  get assetBaseUrl(): string {
    return this.files.assetBaseUrl;
  }

  get libraryBaseUrl(): string {
    return this.files.libraryBaseUrl;
  }

  /** The file source does the downloading, so its limit is the one that counts. */
  get concurrency(): number {
    return this.files.concurrency;
  }

  injectUrl(url: string): string {
    return this.files.injectUrl(url);
  }

  altUrls(url: string): readonly string[] {
    return this.files.altUrls(url);
  }
}

/** Builds the one provider for a given pair of sources. */
function sourceProvider(
  source: DownloadSource,
  modrinthMirrorRoot: string | undefined,
  concurrency: number | undefined
): DownloadProvider {
  return source === 'bmclapi'
    ? new BmclapiDownloadProvider(undefined, modrinthMirrorRoot, concurrency)
    : new MojangDownloadProvider(concurrency);
}

/**
 * The provider for a build, from HMCL 下载 → 下载源: 版本列表源 picks where
 * manifests come from and 文件下载源 where the files do, either of which may be
 * the mirror. HMCL's third option 自动选择下载源 probes for the fastest source
 * and is deliberately absent.
 */
export function createDownloadProvider(options: {
  versionListSource: DownloadSource;
  fileDownloadSource: DownloadSource;
  modrinthMirrorRoot?: string | undefined;
  /** Overrides each source's own default, for 自定义线程数. */
  concurrency?: number | undefined;
}): DownloadProvider {
  const { versionListSource, fileDownloadSource, modrinthMirrorRoot, concurrency } = options;
  const files = sourceProvider(fileDownloadSource, modrinthMirrorRoot, concurrency);
  if (versionListSource === fileDownloadSource) return files;
  return new RoutedDownloadProvider(
    sourceProvider(versionListSource, modrinthMirrorRoot, concurrency),
    files
  );
}
