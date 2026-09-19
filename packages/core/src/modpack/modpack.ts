/**
 * Modpack installation for local `.zip`/`.mrpack` archives.
 *
 * Supports the Modrinth `.mrpack` format (ModrinthIndex) and CurseForge
 * modpack zips (manifest.json). Modrinth files come from the pack's CDN;
 * CurseForge files are pinned as `{projectID, fileID}` pairs, resolved to
 * no-auth Edge CDN links via the public cfwidget mirror and downloaded into
 * the instance's `mods/` folder.
 *
 * Modpack installs always enable version isolation so saves/configs/mods stay
 * inside the instance root (matching HMCL's behavior for new instances).
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, sep } from 'node:path';
import { unzipSync } from 'fflate';
import { type DownloadEntry, type DownloadProgress, Downloader } from '../download/downloader.js';
import type { DownloadProvider } from '../download/mirrors.js';
import type { GameRepository } from '../game/repository.js';
import { writeInstanceSettings } from '../game/instance-settings.js';
import { curseForgeDirectUrl, resolveCurseForgeFiles } from './curseforge.js';
import { fetchFabricLoaders, installFabricVersion } from '../modloaders/fabric.js';
import { fetchForgeBuilds, installForgeVersion } from '../modloaders/forge.js';
import { fetchNeoForgeBuilds, installNeoForgeVersion } from '../modloaders/neoforge.js';
import { installVanillaVersion } from '../version/install.js';

/** Modrinth modpack index (`modrinth.index.json`). */
export interface ModrinthIndex {
  formatVersion: number;
  game: string;
  versionId: string;
  name: string;
  files: ModrinthIndexFile[];
  dependencies: { minecraft: string } & Partial<
    Record<'fabric-loader' | 'forge' | 'neoforge' | 'quilt-loader', string>
  >;
}

export interface ModrinthIndexFile {
  path: string;
  downloads: string[];
  hashes?: { sha1?: string };
  fileSize?: number;
  /** Environment apply rule, e.g. `{ client: "required", server: "unsupported" }`. */
  env?: { client?: string; server?: string };
}

/** CurseForge modpack manifest (`manifest.json`). */
export interface CurseManifest {
  manifestType: string;
  manifestVersion: number;
  name: string;
  version: string;
  files: Array<{ projectID: number; fileID: number; required: boolean }>;
  overrides: string;
  minecraft: { version: string; modLoaders: Array<{ id: string; primary: boolean }> };
}

const UNRECOGNIZED_MESSAGE =
  '无法识别该整合包，目前仅支持导入 Modrinth (.mrpack) 与 CurseForge (.zip) 整合包。';

/** Loader spec resolved from a modpack manifest. */
export interface ModpackLoaderSpec {
  kind: 'fabric' | 'forge' | 'neoforge' | 'quilt';
  version: string | undefined;
}

export interface ModpackInstallOptions {
  /** Java executable required by Forge/NeoForge installers. */
  readonly java?: string | undefined;
  readonly onProgress?: ((progress: DownloadProgress) => void) | undefined;
  readonly onLine?: ((line: string) => void) | undefined;
}

const INSTANCE_NAME_PATTERN = /^[0-9A-Za-z._-]+$/;

/**
 * Installs the modpack at `zipPath` as a new version-isolated instance named
 * `instanceName`.
 *
 * @returns the created instance id
 */
export async function installModpackFile(
  repo: GameRepository,
  provider: DownloadProvider,
  zipPath: string,
  instanceName: string,
  options: ModpackInstallOptions = {}
): Promise<string> {
  if (!INSTANCE_NAME_PATTERN.test(instanceName)) {
    throw new Error('名称只能包含字母、数字、. _ -');
  }
  const installed = await repo.listInstalledVersions();
  if (installed.some((version) => version.id === instanceName)) {
    throw new Error('此实例已经存在，请换一个名字');
  }

  const data = await readFile(zipPath);
  const entries = unzipSync(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));

  const indexJson = entries['modrinth.index.json'];
  const manifestJson = entries['manifest.json'];
  if (indexJson === undefined && manifestJson === undefined) {
    throw new Error(UNRECOGNIZED_MESSAGE);
  }

  const instanceRoot = repo.versionRoot(instanceName);
  await mkdir(instanceRoot, { recursive: true });

  if (indexJson !== undefined) {
    const loaderVersion = await installModrinthMrpack(
      repo, provider, instanceName, parseModrinthIndex(indexJson), entries, options
    );
    await writeModpackVersionJson(repo, instanceName, loaderVersion, indexJson);
  } else {
    const loaderVersion = await installCurseForgeZip(
      repo, provider, instanceName, parseCurseManifest(manifestJson!), entries, options
    );
    await writeModpackVersionJson(repo, instanceName, loaderVersion, undefined, manifestJson);
  }

  // Modpack instances always opt into version isolation.
  await writeInstanceSettings(repo, instanceName, { gameDirType: 'instance' });
  return instanceName;
}

/** Parses `modrinth.index.json` bytes. */
export function parseModrinthIndex(bytes: Uint8Array): ModrinthIndex {
  const parsed = JSON.parse(new TextDecoder().decode(bytes)) as ModrinthIndex;
  const version = parsed.dependencies?.minecraft;
  if (typeof version !== 'string' || version === '') {
    throw new Error('整合包没有声明 Minecraft 版本');
  }
  return parsed;
}

/** Parses a CurseForge `manifest.json`. */
export function parseCurseManifest(bytes: Uint8Array): CurseManifest {
  const parsed = JSON.parse(new TextDecoder().decode(bytes)) as CurseManifest;
  if (parsed.manifestType !== 'minecraftModpack') {
    throw new Error(UNRECOGNIZED_MESSAGE);
  }
  const version = parsed.minecraft?.version;
  if (typeof version !== 'string' || version === '') {
    throw new Error('整合包没有声明 Minecraft 版本');
  }
  return parsed;
}

async function installModrinthMrpack(
  repo: GameRepository,
  provider: DownloadProvider,
  instanceName: string,
  index: ModrinthIndex,
  entries: Record<string, Uint8Array>,
  options: ModpackInstallOptions
): Promise<string> {
  const mcVersion = index.dependencies.minecraft;
  const loaderVersion = await installBaseAndLoader(repo, provider, mcVersion, loaderFromModrinth(index), options);

  // Client-side files download from the CDN into the instance root.
  const downloads: DownloadEntry[] = [];
  for (const file of index.files) {
    if (file.env?.client === 'unsupported') continue;
    const url = file.downloads[0];
    if (url === undefined || file.path === undefined) continue;
    if (file.path.endsWith('/')) continue;
    downloads.push({
      url,
      destination: safeJoin(repo.versionRoot(instanceName), file.path),
      sha1: file.hashes?.sha1,
      size: file.fileSize,
      altUrls: provider.altUrls(url)
    });
  }
  const downloader = new Downloader({
    concurrency: provider.concurrency,
    onProgress: options.onProgress
  });
  if (downloads.length > 0) await downloader.downloadAll(downloads);

  await extractOverrides(repo, instanceName, entries, 'overrides', options.onLine);
  await extractOverrides(repo, instanceName, entries, 'client-overrides', options.onLine);
  return loaderVersion;
}

async function installCurseForgeZip(
  repo: GameRepository,
  provider: DownloadProvider,
  instanceName: string,
  manifest: CurseManifest,
  entries: Record<string, Uint8Array>,
  options: ModpackInstallOptions
): Promise<string> {
  const mcVersion = manifest.minecraft.version;
  const loaderVersion = await installBaseAndLoader(
    repo, provider, mcVersion, loaderFromCurse(manifest.minecraft.modLoaders), options
  );

  // Resolve each pinned file through the public mirror and download it into
  // the instance's mods/ folder. Unresolvable entries are reported and
  // skipped instead of failing the whole install.
  const infos = await resolveCurseForgeFiles(manifest.files);
  const downloads: DownloadEntry[] = [];
  let unresolved = 0;
  for (let index = 0; index < manifest.files.length; index++) {
    const info = infos[index];
    if (info === undefined) {
      unresolved++;
      continue;
    }
    downloads.push({
      url: curseForgeDirectUrl(info.fileID, info.filename),
      destination: safeJoin(repo.versionRoot(instanceName), `mods/${info.filename}`),
      sha1: undefined,
      size: info.fileSize
    });
  }
  if (unresolved > 0) {
    options.onLine?.(
      `⚠ 有 ${unresolved} 个 CurseForge 模组无法解析下载地址，已跳过，` +
        '可稍后前往模组管理手动添加。'
    );
  }
  if (downloads.length > 0) {
    await new Downloader({
      concurrency: provider.concurrency,
      onProgress: options.onProgress
    }).downloadAll(downloads);
    options.onLine?.(`>>> 已下载 ${downloads.length} 个 CurseForge 模组文件`);
  }

  await extractOverrides(repo, instanceName, entries, manifest.overrides ?? 'overrides', options.onLine);
  return loaderVersion;
}

/** Writes the version.json for a modpack instance, inheriting from the loader version. */
async function writeModpackVersionJson(
  repo: GameRepository,
  instanceName: string,
  loaderVersion: string,
  indexJson?: Uint8Array,
  manifestJson?: Uint8Array
): Promise<void> {
  const inheritsFrom = loaderVersion;
  const versionJson = {
    id: instanceName,
    inheritsFrom,
    type: 'modpack',
    modpackInfo: indexJson !== undefined
      ? JSON.parse(new TextDecoder().decode(indexJson))
      : manifestJson !== undefined
        ? JSON.parse(new TextDecoder().decode(manifestJson))
        : undefined
  };
  await writeFile(repo.versionJson(instanceName), JSON.stringify(versionJson, null, 2), 'utf8');
}

/** Installs the base Minecraft version, then the declared loader (if any). */
async function installBaseAndLoader(
  repo: GameRepository,
  provider: DownloadProvider,
  mcVersion: string,
  loader: ModpackLoaderSpec | undefined,
  options: ModpackInstallOptions
): Promise<string> {
  const installed = await repo.listInstalledVersions();
  if (!installed.some((version) => version.id === mcVersion)) {
    await installVanillaVersion(repo, provider, mcVersion, options.onProgress, options.onLine);
  }
  if (loader === undefined) return mcVersion;
  return installLoader(repo, provider, mcVersion, loader, options);
}

/** Maps the mrpack loader dependency to an installable spec. */
export function loaderFromModrinth(index: ModrinthIndex): ModpackLoaderSpec | undefined {
  const dependencies = index.dependencies;
  for (const [key, kind] of [
    ['fabric-loader', 'fabric'],
    ['forge', 'forge'],
    ['neoforge', 'neoforge'],
    ['quilt-loader', 'quilt']
  ] as const) {
    const version = dependencies[key];
    if (version !== undefined) return { kind, version };
  }
  return undefined;
}

/** Maps `minecraft.modLoaders` entries like `fabric-0.16.14` to a spec. */
export function loaderFromCurse(
  modLoaders: CurseManifest['minecraft']['modLoaders']
): ModpackLoaderSpec | undefined {
  const id = modLoaders.find((entry) => entry.primary)?.id ?? modLoaders[0]?.id;
  if (id === undefined) return undefined;
  const dash = id.indexOf('-');
  if (dash < 0) return { kind: id as ModpackLoaderSpec['kind'], version: undefined };
  const kind = id.slice(0, dash);
  if (kind !== 'fabric' && kind !== 'forge' && kind !== 'neoforge' && kind !== 'quilt') {
    return undefined;
  }
  return { kind, version: id.slice(dash + 1) };
}

async function installLoader(
  repo: GameRepository,
  provider: DownloadProvider,
  mcVersion: string,
  loader: ModpackLoaderSpec,
  options: ModpackInstallOptions
): Promise<string> {
  switch (loader.kind) {
    case 'fabric': {
      const builds = await fetchFabricLoaders(provider, mcVersion);
      const chosen = builds.find((build) => build.version === loader.version) ?? builds[0];
      if (chosen === undefined) throw new Error(`Fabric 不支持 Minecraft ${mcVersion}`);
      return installFabricVersion(repo, provider, mcVersion, chosen.version);
    }
    case 'forge': {
      const builds = await fetchForgeBuilds(mcVersion);
      const chosen =
        builds.find((build) => build.version === loader.version) ??
        builds.find((build) => build.recommended) ??
        builds[0];
      if (chosen === undefined) throw new Error(`Forge 不支持 Minecraft ${mcVersion}`);
      if (options.java === undefined) throw new Error('安装 Forge 需要 Java 运行时');
      return installForgeVersion(
        repo, provider, mcVersion, chosen.version, chosen.branch, chosen.build, options.java, options.onLine
      );
    }
    case 'neoforge': {
      const builds = await fetchNeoForgeBuilds(mcVersion);
      const chosen = builds.find((build) => build.version === loader.version) ?? builds[0];
      if (chosen === undefined) throw new Error(`NeoForge 不支持 Minecraft ${mcVersion}`);
      if (options.java === undefined) throw new Error('安装 NeoForge 需要 Java 运行时');
      return installNeoForgeVersion(repo, provider, mcVersion, chosen.version, options.java, options.onLine);
    }
    case 'quilt':
      throw new Error('暂不支持 Quilt 加载器的自动安装');
  }
}

/**
 * Extracts a zip `overrides/` directory into the instance root.
 *
 * Directory entries (paths ending in `/`) are skipped: writing to them would
 * otherwise try to `open()` an existing directory and throw `EISDIR`.
 */
export async function extractOverrides(
  repo: GameRepository,
  instanceName: string,
  entries: Record<string, Uint8Array>,
  prefix: string,
  onLine: ((line: string) => void) | undefined
): Promise<void> {
  const normalizedPrefix = normalize(prefix);
  const root = repo.versionRoot(instanceName);
  let count = 0;
  for (const [path, content] of Object.entries(entries)) {
    if (path.startsWith('__MACOSX/')) continue;
    if (path.endsWith('/')) continue;
    const normalized = normalize(path);
    if (normalized.startsWith(normalizedPrefix + sep)) {
      const relative = normalized.slice(normalizedPrefix.length + 1);
      if (relative === '') continue;
      const target = safeJoin(root, relative);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content);
      count++;
    }
  }
  if (onLine !== undefined && count > 0) onLine(`>>> 已解压 ${count} 个配置文件`);
}

/** Joins a relative pack path onto `root`, refusing directory escapes. */
export function safeJoin(root: string, relative: string): string {
  const normalized = normalize(relative.replace(/^[/\\]+/, ''));
  const target = join(root, normalized);
  const rooted = join(root, '');
  if (!(target.startsWith(rooted) || target.startsWith(root + sep))) {
    throw new Error(`非法路径: ${relative}`);
  }
  return target;
}