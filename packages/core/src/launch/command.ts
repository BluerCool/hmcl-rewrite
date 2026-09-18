/**
 * Launch command construction, a faithful port of HMCL's
 * `DefaultLauncher.generateCommandLine` covering vanilla launches.
 */
import { delimiter, join, sep } from 'node:path';
import { CURRENT_ARCH, CURRENT_OS, mojangOSName } from '../platform/os.js';
import type { ResolvedVersion } from '../version/resolve.js';
import {
  defaultGameArguments,
  defaultJvmArguments,
  interpolate,
  parseArguments,
  type FeatureMap,
  type PlaceholderMap
} from '../version/arguments.js';
import type { AuthInfo } from './auth.js';
import type { LaunchOptions } from './options.js';
import type { GameRepository } from '../game/repository.js';

/** Launcher identity injected into `${launcher_*}` placeholders. */
export const LAUNCHER_NAME = 'HMCL-Rewrite';
export const LAUNCHER_VERSION = '0.1.0';

/** Everything needed to spawn the game process. */
export interface LaunchCommand {
  /** Full argv: [java, ...jvmArgs, mainClass, ...gameArgs]. */
  readonly argv: readonly string[];
  /** Working directory for the game process. */
  readonly workingDirectory: string;
  /** Directory natives were extracted into. */
  readonly nativesDirectory: string;
}

/**
 * Builds the complete launch command line.
 *
 * @param repo      game repository providing path layout
 * @param version   resolved version manifest
 * @param auth      authenticated player
 * @param options   launch options
 */
export function buildLaunchCommand(
  repo: GameRepository,
  version: ResolvedVersion,
  auth: AuthInfo,
  options: LaunchOptions
): LaunchCommand {
  const gameDir = options.gameDir ?? repo.rootDir;
  const jarId = version.jar ?? version.id;
  const primaryJar = repo.versionJar(jarId);
  const nativesDirectory = repo.nativesDir(
    version.id,
    mojangOSName(CURRENT_OS),
    CURRENT_ARCH
  );

  const classpath = buildClasspath(repo, version, primaryJar);
  const assetsRoot = repo.assetsDir();

  const placeholders: PlaceholderMap = {
    // Defined by the official launcher.
    '${auth_player_name}': auth.username,
    '${auth_session}': auth.accessToken,
    '${auth_access_token}': auth.accessToken,
    '${auth_uuid}': auth.uuid.replaceAll('-', ''),
    '${auth_xuid}': '0',
    '${auth_client_id}': '0',
    '${user_type}': auth.userType,
    '${version_name}': version.id,
    '${profile_name}': 'Minecraft',
    '${version_type}': version.type ?? 'release',
    '${game_directory}': gameDir,
    '${assets_root}': assetsRoot,
    '${game_assets}': repo.virtualAssetsDir(version.assetIndexId ?? 'legacy'),
    '${assets_index_name}': version.assetIndexId ?? 'legacy',
    '${user_properties}': '{}',
    '${resolution_width}': String(options.width ?? 854),
    '${resolution_height}': String(options.height ?? 480),
    '${library_directory}': repo.librariesDir(),
    '${libraries_directory}': repo.librariesDir(),
    '${classpath_separator}': delimiter,
    '${file_separator}': sep,
    '${primary_jar}': primaryJar,
    '${primary_jar_name}': `${jarId}.jar`,
    '${language}': Intl.DateTimeFormat().resolvedOptions().locale,
    // HMCL extensions.
    '${launcher_name}': LAUNCHER_NAME,
    '${launcher_version}': LAUNCHER_VERSION,
    '${natives_directory}': nativesDirectory,
    '${classpath}': classpath.join(delimiter),
    '${minecraft_client_jar}': primaryJar
  };

  const features: FeatureMap = {
    has_custom_resolution:
      options.width !== undefined &&
      options.height !== undefined &&
      options.width !== 0 &&
      options.height !== 0
  };

  const argv: string[] = [];

  // Process priority (POSIX only; Windows uses unsupported cmd tricks).
  if (options.processPriority !== undefined && options.processPriority !== 'normal' && process.platform !== 'win32') {
    const nice: Record<string, string> = {
      high: '-5',
      above_normal: '-1',
      below_normal: '1',
      low: '5'
    };
    argv.push('nice', '-n', nice[options.processPriority] ?? '0');
  }

  if (options.wrapper !== undefined && options.wrapper.trim() !== '') {
    argv.push(...options.wrapper.trim().split(/\s+/));
  }

  argv.push(options.javaExecutable);

  if (options.maxMemory !== undefined && options.maxMemory > 0) {
    argv.push(`-Xmx${options.maxMemory}m`);
  }
  if (
    options.minMemory !== undefined &&
    options.minMemory > 0 &&
    (options.maxMemory === undefined || options.minMemory <= options.maxMemory)
  ) {
    argv.push(`-Xms${options.minMemory}m`);
  }

  for (const arg of options.jvmArguments ?? []) {
    argv.push(arg);
  }

  // Encoding + security defaults from DefaultLauncher.
  argv.push('-Dfile.encoding=UTF-8');
  if (options.javaMajorVersion < 19) {
    argv.push('-Dsun.stdout.encoding=UTF-8', '-Dsun.stderr.encoding=UTF-8');
  } else {
    argv.push('-Dstdout.encoding=UTF-8', '-Dstderr.encoding=UTF-8');
  }
  argv.push(
    '-Djava.rmi.server.useCodebaseOnly=true',
    '-Dcom.sun.jndi.rmi.object.trustURLCodebase=false',
    '-Dcom.sun.jndi.cosnaming.object.trustURLCodebase=false',
    '-Dlog4j2.formatMsgNoLookups=true'
  );

  if (options.noGeneratedOptimizingJVMArgs !== true) {
    argv.push(
      '-XX:+UnlockExperimentalVMOptions',
      '-XX:+UseG1GC',
      '-XX:G1NewSizePercent=20',
      '-XX:G1ReservePercent=20',
      '-XX:MaxGCPauseMillis=50',
      '-XX:G1HeapRegionSize=32m'
    );
  }

  argv.push(
    '-Dfml.ignoreInvalidMinecraftCertificates=true',
    '-Dfml.ignorePatchDiscrepancies=true',
    `-Dminecraft.client.jar=${primaryJar}`
  );

  // Version-provided JVM arguments, or the vanilla defaults for old formats.
  const jvmArguments = version.arguments?.jvm ?? defaultJvmArguments();
  argv.push(...parseArguments(jvmArguments, placeholders, features));

  if (version.mainClass === undefined) {
    throw new Error(`Main class is missing for version "${version.id}"`);
  }
  argv.push(version.mainClass);

  // Legacy space-separated game arguments come first when present.
  if (version.minecraftArguments !== undefined) {
    argv.push(
      ...version.minecraftArguments.split(' ').map((token) => interpolate(token, placeholders))
    );
  }  const gameArguments = version.arguments?.game;
  if (gameArguments !== undefined) {
    argv.push(...parseArguments(gameArguments, placeholders, features));
  }
  if (version.minecraftArguments !== undefined) {
    argv.push(...parseArguments(defaultGameArguments(), placeholders, features));
  }

  // Server join: quick play on modern versions, --server/--port otherwise.
  if (options.server !== undefined) {
    const { host, port } = parseServerAddress(options.server);
    if (supportsQuickPlay(version)) {
      argv.push('--quickPlayMultiplayer', port === undefined ? host : `${host}:${port}`);
    } else {
      argv.push('--server', host, '--port', String(port ?? 25565));
    }
  }

  if (options.fullscreen === true) {
    argv.push('--fullscreen');
  }

  for (const arg of options.gameArguments ?? []) {
    argv.push(interpolate(arg, placeholders));
  }

  return {
    argv,
    workingDirectory: gameDir,
    nativesDirectory
  };
}

/** Library files applicable to this platform, ending with the primary jar. */
function buildClasspath(
  repo: GameRepository,
  version: ResolvedVersion,
  primaryJar: string
): string[] {
  const entries: string[] = [];
  for (const library of version.libraries) {
    if (!library.applies() || library.isNative()) continue;
    entries.push(join(repo.librariesDir(), library.downloadInfo().path));
  }
  entries.push(primaryJar);
  return entries;
}

/** Parses `host`, `host:port`, or SRV-style addresses minimally. */
export function parseServerAddress(address: string): { host: string; port: number | undefined } {
  const lastColon = address.lastIndexOf(':');
  if (lastColon > 0) {
    const port = Number.parseInt(address.slice(lastColon + 1), 10);
    if (Number.isInteger(port) && port > 0 && port < 65536) {
      return { host: address.slice(0, lastColon), port };
    }
  }
  return { host: address, port: undefined };
}

/** Quick Play (`--quickPlay*`) requires Minecraft 1.20+. */
function supportsQuickPlay(version: ResolvedVersion): boolean {
  const match = /^(\d+)\.(\d+)/.exec(version.id);
  if (match === null) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > 1 || (major === 1 && minor >= 20);
}
