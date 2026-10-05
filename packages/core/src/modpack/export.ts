/**
 * Exporting an installed instance as a Modrinth `.mrpack`.
 *
 * This is the inverse of `installModpackFile`: the same archive shape the
 * installer reads, written back out from a live instance. HMCL's
 * `ModrinthModpackExportTask` writes an empty `files` list and puts everything
 * under `client-overrides/` (its task is constructed with
 * `requireNoCreateRemoteFiles`, so it never resolves a mod to a remote file),
 * and that is what is reproduced here — the export therefore works for any
 * instance, including one that was never a modpack.
 *
 * HMCL additionally offers MCBBS, MultiMC and server pack types; those are not
 * implemented, so the export is always `.mrpack`.
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { zipSync } from 'fflate';
import { chainManifests, resolveLoaderComponents, rootGameVersion } from '../version/components.js';
import type { GameVersionJson } from '../version/types.js';
import type { GameRepository } from '../game/repository.js';
import type { ModpackLoaderSource, ModpackSource } from './source.js';
import { modpackSourceOf } from './source.js';
import type { ModrinthIndex, ModrinthIndexFile } from './modpack.js';

/** Where the exported archive keeps the instance's own files. */
export const OVERRIDES_PREFIX = 'client-overrides';

/** What the user fills in before the archive is written. */
export interface ModpackExportInfo {
  name: string;
  version: string;
  /**
   * One-line description. A Modrinth index has no author field (HMCL's
   * `ModrinthManifest` carries only `summary` as free text), so the author
   * HMCL's export page also asks for is not written anywhere.
   */
  summary: string | undefined;
}

/** What the archive ended up containing. */
export interface ModpackExportResult {
  /** Number of files under `client-overrides/`. */
  files: number;
  /** Archive size in bytes. */
  bytes: number;
  /** Files the blacklist would have let through but the user excluded. */
  skipped: string[];
}

/**
 * Names that never belong in an exported pack, ported from HMCL's
 * `ModAdviser.MODPACK_BLACK_LIST`.
 *
 * A plain entry matches the whole relative path or any path under a directory
 * of that name; a `regex:` entry is matched against the path, the same two
 * forms `ModAdviser.match` accepts.
 */
export const MODPACK_BLACK_LIST: readonly string[] = [
  'regex:(.*?)\\.log',
  'regex:.*\\.dat_old$',
  'regex:.*\\.old$',
  'regex:.*\\.BakaCoreInfo$',
  'regex:.*-natives',
  'usernamecache.json',
  'usercache.json',
  'launcher_profiles.json',
  'launcher.pack.lzma',
  'launcher_accounts.json',
  'launcher_cef_log.txt',
  'launcher_log.txt',
  'launcher_msa_credentials.bin',
  'launcher_settings.json',
  'launcher_ui_state.json',
  'realms_persistence.json',
  'webcache2',
  'treatment_tags.json',
  'clientId.txt',
  'PCL.ini',
  '.hmcl',
  'backup',
  'pack.json',
  'launcher.jar',
  'cache',
  'modpack.cfg',
  'log4j2.xml',
  'hmclversion.cfg',
  'instance-game-settings.json',
  'manifest.json',
  'minecraftinstance.json',
  '.curseclient',
  'modrinth.index.json',
  '.fabric',
  '.mixin.out',
  '.optifine',
  'jars',
  'logs',
  'versions',
  'assets',
  'libraries',
  'crash-reports',
  'NVIDIA',
  'AMD',
  'screenshots',
  'natives',
  'native',
  '$native',
  '$natives',
  'server-resource-packs',
  'command_history.txt',
  'downloads',
  'essential',
  'asm',
  'backups',
  'TCNodeTracker',
  'CustomDISkins',
  'data',
  'CustomSkinLoader/caches',
  'debug',
  '.replay_cache',
  'replay_recordings',
  'replay_videos',
  'irisUpdateInfo.json',
  'modernfix',
  'modtranslations',
  'schematics',
  'journeymap/data',
  'mods/.connector'
];

/**
 * Paths HMCL shows but leaves unchecked by default
 * (`ModAdviser.MODPACK_SUGGESTED_BLACK_LIST`): worlds, client options and other
 * per-machine state that a pack should not carry between players.
 */
export const MODPACK_SUGGESTED_BLACK_LIST: readonly string[] = [
  'fonts',
  'saves',
  'servers.dat',
  'options.txt',
  'blueprints',
  'optionsof.txt',
  'journeymap',
  'optionsshaders.txt',
  'mods/VoxelMods'
];

/**
 * Top-level folders this launcher writes that HMCL's lists do not name.
 *
 * `GameRepository.nativesDir` suffixes the folder with the OS and architecture so
 * several JVMs can coexist (`natives-linux-x86_64`), so the plain `natives`
 * entry above does not catch it. Real exports picked these up otherwise.
 */
const LOCAL_EXCLUDED_TOP_LEVEL = /^natives(-.+)?$/;

/**
 * Whether one path is left out of the export.
 *
 * `ModAdviser.match` tests directories with a `name + '/'` prefix, which a walk
 * over files never reaches; matching the prefix here too means a listed
 * directory prunes everything under it, as it does in HMCL's `Zipper` walk.
 */
export function isExcludedFromExport(relativePath: string): boolean {
  if (LOCAL_EXCLUDED_TOP_LEVEL.test(topLevelOf(relativePath))) return true;
  return matchesList(relativePath, MODPACK_BLACK_LIST) || matchesList(relativePath, MODPACK_SUGGESTED_BLACK_LIST);
}

function topLevelOf(relativePath: string): string {
  const cut = relativePath.indexOf('/');
  return cut < 0 ? relativePath : relativePath.slice(0, cut);
}

function matchesList(relativePath: string, list: readonly string[]): boolean {
  for (const pattern of list) {
    if (pattern.startsWith('regex:')) {
      if (new RegExp(pattern.slice('regex:'.length)).test(relativePath)) return true;
    } else if (relativePath === pattern || relativePath.startsWith(`${pattern}/`)) {
      return true;
    }
  }
  return false;
}

/**
 * The loader dependency a `.mrpack` declares, taken from the modpack the
 * instance was installed from.
 *
 * HMCL reads it off the analyzer (`getVersion(FORGE)` and friends). An instance
 * that came from a modpack already states its loader in `modpackInfo`, which is
 * the same value the installer's own index carried; without that we fall back to
 * the analyzer path, which is why this prefers the manifest and only uses the
 * library scan to fill a gap.
 */
export function loaderDependencyOf(
  manifest: GameVersionJson,
  chain: readonly GameVersionJson[]
): ModpackLoaderSource | undefined {
  const declared = modpackSourceOf(manifest)?.loader;
  if (declared !== undefined) return declared;
  const found = resolveLoaderComponents(chain, undefined).find((loader) => loader.version !== undefined);
  if (found === undefined) return undefined;
  const key: ModpackLoaderSource['key'] | undefined =
    found.slug === 'fabric'
      ? 'fabric-loader'
      : found.slug === 'quilt'
        ? 'quilt-loader'
        : found.slug === 'forge'
          ? 'forge'
          : found.slug === 'neoforge'
            ? 'neoforge'
            : undefined;
  return key === undefined ? undefined : { key, version: found.version! };
}

/** Builds the `modrinth.index.json` an instance would be exported with. */
export async function buildModrinthIndex(
  repo: GameRepository,
  instanceId: string,
  info: ModpackExportInfo
): Promise<ModrinthIndex> {
  const installed = await repo.listInstalledVersions();
  const manifests = new Map(installed.map((version) => [version.id, version.manifest]));
  const own = manifests.get(instanceId);
  const chain = chainManifests(instanceId, manifests);
  const gameVersion = rootGameVersion(instanceId, manifests);
  const loader = own === undefined ? undefined : loaderDependencyOf(own, chain);
  return {
    formatVersion: 1,
    game: 'minecraft',
    versionId: info.version,
    name: info.name,
    ...(info.summary === undefined || info.summary === '' ? {} : { summary: info.summary }),
    // Always empty: HMCL's Modrinth export task is built with
    // requireNoCreateRemoteFiles, so it puts every file in the overrides.
    files: [] as ModrinthIndexFile[],
    dependencies: {
      minecraft: gameVersion,
      ...(loader === undefined ? {} : { [loader.key]: loader.version })
    }
  };
}

/**
 * Writes `instanceId` out as a `.mrpack`.
 *
 * @param runDirectory the instance's run directory, i.e. what a launch uses as
 *   `--gameDir`; passed in because a global custom game directory is a launcher
 *   setting the repository does not know about.
 * @param include      paths to include; defaults to everything the blacklist
 *   does not exclude. HMCL lets the user untick entries on a selection page,
 *   which is the same thing expressed as a whitelist.
 */
export async function exportModrinthMrpack(
  repo: GameRepository,
  instanceId: string,
  runDirectory: string,
  info: ModpackExportInfo,
  destination: string,
  include?: readonly string[]
): Promise<ModpackExportResult> {
  const index = await buildModrinthIndex(repo, instanceId, info);
  // HMCL's export adds these two per-instance files to the shared blacklist
  // (`ModrinthModpackExportTask#execute`), since a version-isolated instance
  // keeps its own manifest next to the game files.
  const { files, skipped } = await collectOverrides(
    runDirectory,
    include,
    [`${instanceId}.jar`, `${instanceId}.json`]
  );
  const archive = zipSync({
    'modrinth.index.json': strToBytes(JSON.stringify(index, null, 2)),
    ...files
  });
  await writeFile(destination, archive);
  return { files: Object.keys(files).length, bytes: archive.length, skipped };
}

function strToBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** Every file under `runDirectory` that the export should carry, keyed by path. */
async function collectOverrides(
  runDirectory: string,
  include: readonly string[] | undefined,
  extraExcluded: readonly string[]
): Promise<{ files: Record<string, Uint8Array>; skipped: string[] }> {
  const files: Record<string, Uint8Array> = {};
  const skipped: string[] = [];
  // An unreadable run directory is reported rather than swallowed: silently
  // producing an index-only archive would look like a successful export of an
  // instance that happens to have no mods or config.
  const entries = await readdir(runDirectory, { recursive: true, withFileTypes: true }).catch(
    (reason: unknown) => {
      throw new Error(`无法读取实例目录 ${runDirectory}: ${String(reason)}`);
    }
  );
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const absolute = join(entry.parentPath, entry.name);
    const relativePath = toArchivePath(relative(runDirectory, absolute));
    const keep =
      include === undefined
        ? !isExcludedFromExport(relativePath) && !extraExcluded.includes(relativePath)
        : include.includes(relativePath);
    if (!keep) {
      skipped.push(relativePath);
      continue;
    }
    files[`${OVERRIDES_PREFIX}/${relativePath}`] = await readFile(absolute);
  }
  return { files, skipped };
}

/** Archive paths always use `/`, never the host separator. */
function toArchivePath(path: string): string {
  return sep === '/' ? path : path.split(sep).join('/');
}

/** The export metadata an already-installed modpack suggests as defaults. */
export function suggestedExportInfo(source: ModpackSource | undefined, instanceId: string): ModpackExportInfo {
  return {
    name: source?.name ?? instanceId,
    version: source?.version ?? '1.0.0',
    summary: source?.summary
  };
}