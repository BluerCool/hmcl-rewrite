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
  readonly concurrency = 6;

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

  constructor(apiRoot: string = BMCLAPI_ROOT, modrinthMirrorRoot: string = MODRINTH_MIRROR_ROOT) {
    this.apiRoot = apiRoot.replace(/\/$/, '');
    this.modrinthMirrorRoot = modrinthMirrorRoot.replace(/\/$/, '');
    this.versionManifestUrl = `${this.apiRoot}/mc/game/version_manifest_v2.json`;
    this.assetBaseUrl = `${this.apiRoot}/assets/`;
    this.libraryBaseUrl = `${this.apiRoot}/maven/`;
    this.concurrency = Math.max(cpus().length * 2, 6);
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
