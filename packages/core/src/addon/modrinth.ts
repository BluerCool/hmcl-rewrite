/**
 * Modrinth API client (v2): project search and version listing used by the
 * download page for 模组/资源包/光影/整合包 and by installer-API cards.
 *
 * The public API needs no authentication for read operations.
 */
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { type DownloadProgress, Downloader } from '../download/downloader.js';
import type { DownloadProvider } from '../download/mirrors.js';
import { readInstanceSettings } from '../game/instance-settings.js';
import type { GameRepository } from '../game/repository.js';
export type ModrinthProjectType = 'mod' | 'modpack' | 'resourcepack' | 'shader';

/** A Modrinth category (from `GET /tag/category`), e.g. 科技/魔法. */
export interface ModrinthCategory {
  readonly slug: string;
  readonly name: string;
  readonly iconUrl: string | undefined;
  readonly projectType: ModrinthProjectType;
}

/** Search result / project summary, mapped from `GET /search` hits. */
export interface ModrinthProject {
  readonly slug: string;
  readonly title: string;
  readonly description: string;
  readonly iconUrl: string | undefined;
  readonly author: string;
  readonly downloads: number;
  readonly projectType: ModrinthProjectType;
  /** Game versions advertised by the project's latest version. */
  readonly gameVersions: string[];
  /** Category slugs the project belongs to ('minecraft' server-side remains omitted). */
  readonly categories: string[];
  readonly latestVersionNumber: string | undefined;
}

/** A downloadable file inside a Modrinth version. */
export interface ModrinthFile {
  readonly url: string;
  readonly filename: string;
  readonly size: number | undefined;
  readonly sha1: string | undefined;
  readonly primary: boolean;
}

/** Modrinth version entry, mapped from `GET /project/{id}/version`. */
export interface ModrinthVersion {
  readonly id: string;
  readonly projectId: string;
  readonly versionNumber: string;
  readonly name: string;
  readonly gameVersions: string[];
  readonly loaders: string[];
  readonly files: ModrinthFile[];
  /** ISO-8601 publish time; absent when the API omits it. */
  readonly datePublished: string | undefined;
  /** Release channel: 'alpha' | 'beta' | 'release'. */
  readonly versionType: string | undefined;
  /** URL of the version changelog page, when the API provides one. */
  readonly changelogUrl: string | undefined;
  /** Declared dependencies (loader, game, other projects). */
  readonly dependencies: readonly ModrinthDependency[];
}

/** Dependency of a Modrinth version (e.g. the base game or loader). */
export interface ModrinthDependency {
  readonly projectId: string;
  readonly versionId: string | undefined;
  readonly dependencyType: string;
}

const MODRINTH_API = 'https://api.modrinth.com/v2';

/** Sleeps for `ms` milliseconds. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetches and JSON-parses a URL, retrying transient network failures and
 * temporary server errors (5xx / 429) with an exponential backoff.
 *
 * Network timeouts are common on flaky connections (the Modrinth API in
 * particular), so transient failures are retried up to `attempts` times with
 * a small random jitter to avoid thundering-herd reconnects.
 *
 * @throws Error when the last attempt still fails
 */
async function fetchJsonWithRetry(url: string, label: string, attempts = 5): Promise<unknown> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
      const retriable = response.status >= 500 || response.status === 429;
      if (!retriable) throw new Error(`${label} failed: HTTP ${response.status}`);
      lastError = new Error(`${label} failed: HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < attempts) {
      const backoff = Math.min(500 * 2 ** (attempt - 1), 8000) * (0.6 + Math.random() * 0.8);
      await delay(Math.round(backoff));
    }
  }
  if (lastError instanceof Error) throw lastError;
  throw new Error(`${label} failed`);
}

/** Temporary expansion while the search payload stays untyped upstream. */
type ModrinthSearchHit = {
  project_id: string;
  project_type: string;
  slug: string;
  title: string;
  description: string;
  author: string;
  downloads: number;
  icon_url: string | undefined;
  categories: string[];
  versions: string[];
  latest_version: string | undefined;
};

type ModrinthCategoryPayload = {
  slug: string;
  name: string;
  icon: string | undefined;
  project_type: string;
};

type ModrinthVersionPayload = {
  id: string;
  project_id: string;
  project_type?: string;
  name: string;
  version_number: string;
  game_versions: string[];
  loaders: string[];
  files: Array<{
    hashes?: Record<string, string>;
    url: string;
    filename: string;
    size: number | undefined;
    primary?: boolean;
  }>;
  date_published?: string;
  version_type?: string;
  changelog_url?: string;
  dependencies?: Array<{
    project_id?: string;
    version_id?: string | null;
    dependency_type?: string;
  }>;
};

/** Options controlling a project search. */
export interface ModrinthSearchOptions {
  type: ModrinthProjectType;
  readonly query?: string | undefined;
  /** Limits results to versions supporting this game version via facets. */
  readonly gameVersion?: string | undefined;
  /** Limits results to projects in these Modrinth category slugs via facets. */
  readonly categories?: readonly string[] | undefined;
  /** Sort order; the request page when `offset`/`limit` are set. */
  readonly index?: ModrinthSearchIndex | undefined;
  readonly offset?: number | undefined;
  readonly limit?: number | undefined;
}

/** Modrinth search indexes surfaced in the 排序 dropdown. */
export type ModrinthSearchIndex = 'relevance' | 'newest' | 'updated' | 'downloads';

/** A paged slice of search hits plus the total match count. */
export interface ModrinthSearchResult {
  readonly projects: ModrinthProject[];
  readonly totalHits: number;
}

/**
 * Searches Modrinth for projects of the given type.
 *
 * @returns a page of projects (`offset`/`limit`) with the total hit count
 */
export async function searchModrinthProjects(
  options: ModrinthSearchOptions
): Promise<ModrinthSearchResult> {
  const facets: string[][] = [[`project_type:${options.type}`]];
  if (options.gameVersion !== undefined && options.gameVersion !== '') {
    facets.push([`versions:${options.gameVersion}`]);
  }
  const categories = (options.categories ?? []).filter((slug) => slug !== '');
  if (categories.length > 0) {
    facets.push(categories.map((slug) => `categories:${slug}`));
  }

  const url = new URL(`${MODRINTH_API}/search`);
  url.searchParams.set('query', options.query ?? '');
  url.searchParams.set('facets', JSON.stringify(facets));
  url.searchParams.set('index', options.index ?? 'relevance');
  url.searchParams.set('limit', String(options.limit ?? 20));
  url.searchParams.set('offset', String(options.offset ?? 0));

  const response = await fetchJsonWithRetry(url.href, 'Modrinth search');
  const payload = response as { hits?: ModrinthSearchHit[]; total_hits?: number };
  return {
    projects: (payload.hits ?? []).map(mapModrinthSearchHit),
    totalHits: payload.total_hits ?? (payload.hits ?? []).length
  };
}

function mapModrinthSearchHit(hit: ModrinthSearchHit): ModrinthProject {
  return {
    slug: hit.slug,
    title: hit.title,
    description: hit.description,
    iconUrl: hit.icon_url === undefined || hit.icon_url === '' ? undefined : hit.icon_url,
    author: hit.author,
    downloads: hit.downloads,
    projectType: hit.project_type as ModrinthProjectType,
    gameVersions: hit.versions,
    categories: hit.categories ?? [],
    latestVersionNumber: hit.latest_version
  };
}

/**
 * Lists the Modrinth categories available for a project type.
 *
 * @returns categories as returned by `GET /tag/category`
 */
export async function fetchModrinthCategories(
  projectType: ModrinthProjectType
): Promise<ModrinthCategory[]> {
  const url = new URL(`${MODRINTH_API}/tag/category`);
  url.searchParams.set('project_type', projectType);
  const payload = (await fetchJsonWithRetry(url.href, 'Modrinth categories')) as ModrinthCategoryPayload[];
  return payload.map((entry) => ({
    slug: entry.slug,
    name: entry.name,
    iconUrl: entry.icon === undefined || entry.icon === '' ? undefined : entry.icon,
    projectType: entry.project_type as ModrinthProjectType
  }));
}

/**
 * Lists all released versions of a project (by slug or id).
 *
 * @returns versions newest-first
 */
export async function fetchModrinthVersions(projectIdOrSlug: string): Promise<ModrinthVersion[]> {
  const url = `${MODRINTH_API}/project/${encodeURIComponent(projectIdOrSlug)}/version`;
  const payload = (await fetchJsonWithRetry(url, 'Modrinth versions')) as ModrinthVersionPayload[];
  return payload.map((entry) => mapModrinthVersion(entry));
}

/** Filters a version list to those supporting `mcVersion` and a loader. */
export function filterModrinthVersions(
  versions: readonly ModrinthVersion[],
  mcVersion: string,
  loader?: string | undefined
): ModrinthVersion[] {
  const fmt = (name: string): string => name.toLowerCase();
  const needle = fmt(mcVersion);
  return versions.filter((version) => {
    if (!version.gameVersions.some((game) => fmt(game) === needle)) return false;
    if (loader !== undefined && !version.loaders.some((entry) => fmt(entry) === fmt(loader))) {
      return false;
    }
    return true;
  });
}

function mapModrinthVersion(entry: ModrinthVersionPayload): ModrinthVersion {
  return {
    id: entry.id,
    projectId: entry.project_id,
    versionNumber: entry.version_number,
    name: entry.name,
    gameVersions: entry.game_versions,
    loaders: entry.loaders,
    files: entry.files.map((file) => ({
      url: file.url,
      filename: file.filename,
      size: file.size,
      sha1: file.hashes?.['sha1'],
      primary: file.primary === true
    })),
    datePublished: entry.date_published,
    versionType: entry.version_type,
    changelogUrl: entry.changelog_url,
    dependencies: (entry.dependencies ?? []).map((dependency) => ({
      projectId: dependency.project_id ?? '',
      versionId: dependency.version_id ?? undefined,
      dependencyType: dependency.dependency_type ?? ''
    }))
  };
}

/** Returns the primary download of a version, falling back to the first. */
export function primaryFileOf(version: ModrinthVersion): ModrinthFile {
  return version.files.find((file) => file.primary) ?? version.files[0]!;
}

/** Instance subdirectories an addon file is installed into. */
export type AddonSubdir = 'mods' | 'resourcepacks' | 'shaderpacks';

/**
 * Downloads the primary file of a Modrinth version into an instance's run
 * directory's addon folder (mods/resourcepacks/shaderpacks).
 *
 * @throws Error when the version carries no downloadable file
 */
export async function downloadAddonFile(
  repo: GameRepository,
  provider: DownloadProvider,
  instanceId: string,
  subdir: AddonSubdir,
  version: ModrinthVersion,
  onProgress?: (progress: DownloadProgress) => void
): Promise<void> {
  const file = primaryFileOf(version);
  if (file === undefined) throw new Error('该版本没有可下载的文件');

  // Version-isolated instances keep addons inside the version root; global
  // instances share the repository root — the same rule the launcher applies.
  const settings = await readInstanceSettings(repo, instanceId);
  const runDir =
    settings.gameDirType === 'instance' ? repo.versionRoot(instanceId) : repo.rootDir;
  const targetDir = join(runDir, subdir);
  await mkdir(targetDir, { recursive: true });
  await new Downloader({
    concurrency: provider.concurrency,
    onProgress
  }).downloadAll([
    {
      url: file.url,
      destination: join(targetDir, file.filename),
      sha1: file.sha1,
      size: file.size,
      altUrls: provider.altUrls(file.url)
    }
  ]);
}