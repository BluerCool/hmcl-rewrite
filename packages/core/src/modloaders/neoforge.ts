/**
 * NeoForge support.
 *
 * Versioning (per https://docs.neoforged.net/docs/gettingstarted/versioning):
 * the NeoForge version is `<mc_minor>.<mc_patch>.<build>` — e.g. `21.0.167`
 * targets Minecraft 1.21.0, `20.2.59` targets 1.20.2 — with the leading `1`
 * of the Minecraft version omitted. Since Minecraft switched to date-based
 * versions the full MC version becomes the line prefix (`26.1.2.<build>` for
 * MC 26.1.2). Minecraft 1.20.1 is the one exception: it uses Forge-scheme
 * numbers and is not listed here.
 *
 * Installation runs the official installer with `--installClient`. The
 * installer hardcodes `maven.neoforged.net` for library downloads, which is
 * unreachable on some networks, so we pre-download every library ourselves
 * (the installer skips files that already exist with a valid checksum).
 */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BMCLAPI_ROOT, type DownloadProvider } from '../download/mirrors.js';
import { Downloader, type DownloadProgress } from '../download/downloader.js';
import { Artifact } from '../version/artifact.js';
import { GameRepository } from '../game/repository.js';
import { ensureLauncherProfiles, fileExists, waitForExit } from './internal.js';
import { Launcher } from '../launch/launcher.js';

const OFFICIAL_MAVEN = 'https://maven.neoforged.net/releases';

/** A NeoForge build for one Minecraft version line. */
export interface NeoForgeBuild {
  /** Exact NeoForge version string, e.g. `21.0.167`. */
  readonly version: string;
}

/**
 * Maps a Minecraft version to its NeoForge version-line prefix.
 *
 * Examples (per the official versioning doc): `1.21` → `21.0`,
 * `1.21.4` → `21.4`, date-era `26.1.2` → `26.1.2`.
 */
export function neoForgeLine(mcVersion: string): string {
  if (!mcVersion.startsWith('1.')) return mcVersion;
  const rest = mcVersion.slice(2); // e.g. "21" or "21.4"
  return rest.includes('.') ? rest : `${rest}.0`;
}

interface MavenMetadata {
  versioning?: { versions?: { version?: string[] } };
}

/** Official API response shape ({@link OFFICIAL_API}). */
interface OfficialVersionsResponse {
  isSnapshot?: boolean;
  versions?: string[];
}

const OFFICIAL_API =
  'https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge';

/** Lists NeoForge builds for `mcVersion`, newest last in maven order. */
export async function fetchNeoForgeBuilds(mcVersion: string): Promise<NeoForgeBuild[]> {
  const prefix = `${neoForgeLine(mcVersion)}.`;
  const versions = await fetchAllVersions();
  const matched = versions.filter((version) => version.startsWith(prefix));
  // Numeric-aware sort so 21.0.9 < 21.0.42.
  return matched
    .sort((a, b) => compareNumeric(a, b))
    .map((version) => ({ version }));
}

function compareNumeric(a: string, b: string): number {
  const pa = a.split('.').map((x) => Number.parseInt(x, 10) || 0);
  const pb = b.split('.').map((x) => Number.parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const delta = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

async function fetchAllVersions(): Promise<string[]> {
  // Prefer the official JSON API; fall back to the BMCLAPI-mirrored metadata.
  try {
    const response = await fetch(OFFICIAL_API, { signal: AbortSignal.timeout(10_000) });
    if (response.ok) {
      const payload = (await response.json()) as OfficialVersionsResponse;
      if (Array.isArray(payload.versions)) return payload.versions;
    }
  } catch {
    // Fall through to the mirror.
  }
  const response = await fetch(`${BMCLAPI_ROOT}/maven/net/neoforged/neoforge/maven-metadata.xml`);
  if (!response.ok) {
    throw new Error(`NeoForge metadata fetch failed: HTTP ${response.status}`);
  }
  const xml = await response.text();
  return [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map((match) => match[1]!);
}

/** The version id the official installer creates in the game directory. */
export function neoForgeVersionId(build: string): string {
  return `neoforge-${build}`;
}

interface InstallerProfileLibrary {
  name?: string;
  url?: string;
  checksums?: string[];
  downloads?: {
    artifact?: { path?: string; url?: string; sha1?: string };
  };
}

/**
 * Installs NeoForge by running the official installer after pre-seeding every
 * required library into the repository.
 *
 * @returns the created version id (e.g. `neoforge-21.0.167`)
 */
export async function installNeoForgeVersion(
  repo: GameRepository,
  provider: DownloadProvider,
  mcVersion: string,
  build: string,
  javaExecutable: string,
  onLine?: (line: string) => void,
  onProgress?: (progress: DownloadProgress) => void,
  onStage?: (stage: string) => void
): Promise<string> {
  onStage?.('resolving');
  if (!(await fileExists(repo.versionJson(mcVersion)))) {
    throw new Error(`Vanilla ${mcVersion} is not installed; install it first`);
  }

  const installer = await downloadInstaller(provider, build);
  onLine?.(`>>> 运行安装器: ${installer}`);
  await seedLibraries(repo, provider, installer, onLine);
  await ensureLauncherProfiles(repo);

  const child = spawn(
    javaExecutable,
    ['-jar', installer, '--installClient', repo.rootDir],
    { cwd: repo.rootDir, stdio: ['ignore', 'pipe', 'pipe'] }
  );
  for (const stream of [child.stdout, child.stderr]) {
    if (stream === null) continue;
    createInterface({ input: stream }).on('line', (line) => onLine?.(line));
  }

  const exitCode = await waitForExit(child);
  const id = neoForgeVersionId(build);
  if (exitCode !== 0 || !(await fileExists(repo.versionJson(id)))) {
    throw new Error(`NeoForge installer failed (exit ${String(exitCode)})`);
  }
  onStage?.('downloading-libraries');
  await new Launcher(repo, provider).ensureGameFiles(await repo.resolveInstalledVersion(id), undefined);
  onStage?.('downloading-assets');
  onStage?.('finished');
  return id;
}

async function downloadInstaller(provider: DownloadProvider, build: string): Promise<string> {
  const filename = `neoforge-${build}-installer.jar`;
  const candidates = [
    `${BMCLAPI_ROOT}/maven/net/neoforged/neoforge/${build}/${filename}`,
    provider.injectUrl(`${OFFICIAL_MAVEN}/net/neoforged/neoforge/${build}/${filename}`)
  ];
  const target = join(tmpdir(), filename);
  let lastError: unknown = new Error('no candidate URLs');
  for (const url of candidates) {
    try {
      await new Downloader({ concurrency: 4 }).downloadOne({ url, destination: target });
      if (await fileExists(target)) return target;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/** Pre-downloads every library referenced by the installer jar. */
async function seedLibraries(
  repo: GameRepository,
  provider: DownloadProvider,
  installerPath: string,
  onLine?: (line: string) => void
): Promise<void> {
  const entries = await readInstallerLibraries(installerPath);
  if (entries.length === 0) return;

  const downloader = new Downloader({ concurrency: provider.concurrency });
  const planned = [];
  for (const entry of entries) {
    const target = join(repo.librariesDir(), entry.path);
    if (await fileExists(target)) continue;
    planned.push({
      url: provider.injectUrl(entry.url),
      destination: target,
      sha1: entry.sha1,
      size: undefined,
      altUrls: [entry.url]
    });
  }
  onLine?.(`>>> 预下载 ${String(planned.length)} 个 NeoForge 依赖库…`);
  if (planned.length > 0) {
    await downloader.downloadAll(planned);
  }
}

interface InstallerJsonShape {
  libraries?: InstallerProfileLibrary[];
}

/**
 * Extracts the main artifact download list from `install_profile.json` and
 * `version.json` inside the installer jar. Node has no built-in zip reader,
 * so we shell out to `unzip -p` (present on all target platforms).
 */
async function readInstallerLibraries(
  installerPath: string
): Promise<{ path: string; url: string; sha1: string | undefined }[]> {
  const { execFile } = await import('node:child_process');
  const run = (file: string): Promise<string> =>
    new Promise((resolve, reject) => {
      execFile(
        'unzip',
        ['-p', installerPath, file],
        { timeout: 20_000, maxBuffer: 32 * 1024 * 1024 },
        (error, stdout) => {
          if (error !== null && stdout === '') reject(error);
          else resolve(stdout);
        }
      );
    });

  const results: { path: string; url: string; sha1: string | undefined }[] = [];
  for (const entryName of ['install_profile.json', 'version.json']) {
    let payload: InstallerJsonShape | undefined;
    try {
      payload = JSON.parse(await run(entryName)) as InstallerJsonShape;
    } catch {
      continue;
    }
    for (const lib of payload.libraries ?? []) {
      const name = lib.name?.split('@')[0];
      if (name === undefined) continue;
      const artifact = new Artifact(name);
      const sha1 = lib.downloads?.artifact?.sha1 ?? lib.checksums?.[0];
      const url =
        lib.downloads?.artifact?.url ??
        (lib.url !== undefined ? joinUrl(lib.url, artifact.path) : `${OFFICIAL_MAVEN}/${artifact.path}`);
      results.push({
        path: lib.downloads?.artifact?.path ?? artifact.path,
        url,
        sha1: typeof sha1 === 'string' ? sha1 : undefined
      });
    }
  }
  return dedupe(results);
}

function joinUrl(base: string, path: string): string {
  return base.endsWith('/') ? base + path : `${base}/${path}`;
}

function dedupe(entries: { path: string; url: string; sha1: string | undefined }[]): typeof entries {
  const map = new Map<string, (typeof entries)[number]>();
  for (const entry of entries) {
    const existing = map.get(entry.path);
    if (existing === undefined) map.set(entry.path, entry);
  }
  return [...map.values()];
}
