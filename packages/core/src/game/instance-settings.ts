/**
 * Per-instance game settings, mirroring HMCL's
 * `<versionRoot>/.hmcl/config/instance-game-settings.json`.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { GameRepository } from '../game/repository.js';
import type { LaunchOptions } from '../launch/options.js';

/** Process priority levels passed to `nice` on POSIX systems. */
export type ProcessPriority = 'high' | 'above_normal' | 'normal' | 'below_normal' | 'low';

/** Instance-scoped overrides; absent fields inherit global settings. */
export interface InstanceSettings {
  /** When true (default) memory is chosen automatically. */
  autoMemory?: boolean;
  /** Initial heap in MiB. */
  minMemory?: number;
  /** Maximum heap in MiB. */
  maxMemory?: number;
  /** Metaspace size in MiB (deprecated JVM memory option). */
  permSize?: number;
  /** Raw extra JVM arguments string. */
  javaArgs?: string;
  /** `instance` enables version isolation (own saves/configs). */
  gameDirType?: 'global' | 'instance';
  /** Java executable override for this instance. */
  javaExecutable?: string;
  /** Initial window width; enables the custom-resolution feature flag. */
  width?: number;
  /** Initial window height. */
  height?: number;
  /** Launch the game in fullscreen. */
  fullscreen?: boolean;
  /** Server to join after launch (`host` or `host:port`). */
  server?: string;
  /** Raw extra game arguments string, tokenized at launch. */
  gameArguments?: string;
  /** Environment variables in `KEY=VALUE` form, separated by `;` or newlines. */
  environmentVariables?: string;
  /** Process priority for the game process. */
  processPriority?: ProcessPriority;
  /** Wrapper command prefix (e.g. `optirun`). */
  wrapper?: string;
  /** When true, skip HMCL-generated optimizing JVM arguments. */
  noOptimizingJVMArgs?: boolean;
  /**
   * The built-in icon the user picked in the settings page, e.g. `CHEST` — one
   * of `INSTANCE_ICON_TYPES`' ids, written the same way HMCL writes its
   * `GameInstanceIconType` enum name so the two settings files stay
   * comparable. Absent means \"derive the icon from the instance\".
   *
   * A custom image is not recorded here: it lives as `icon.<ext>` in the
   * version root and is found by name, exactly as HMCL's `getIconFile` does.
   * (Older builds of this launcher stored the file *name* here; such a value
   * names no icon type and is ignored, with the file still found by name.)
   */
  icon?: string;
  /** Window state at launch, mirroring HMCL's WindowType. */
  windowType?: 'windowed' | 'maximized' | 'fullscreen';
  /**
   * Quick Play mode: `multiplayer` joins `server` after launch,
   * `singleplayer` opens `quickPlayWorld`, `realms` opens the Realms menu.
   */
  quickPlay?: 'none' | 'multiplayer' | 'singleplayer' | 'realms';
  /** World name used by the `singleplayer` quick play mode. */
  quickPlayWorld?: string;
  /** When true, omit the launcher's default JVM arguments entirely. */
  noJvmArgs?: boolean;
  /** When true, skip Java/version compatibility checks (persisted only). */
  dontCheckJvmValidity?: boolean;
  /** Shell command executed before the game process starts. */
  precallCommand?: string;
  /** Shell command executed after the game process exits. */
  postExitCommand?: string;
  /** Render backend hint (only Minecraft 26.2+ honours it). */
  graphicsBackend?: 'default' | 'opengl' | 'vulkan';
  /** When true, use `nativesDirectory` instead of extracted natives. */
  useCustomNatives?: boolean;
  /** Absolute path of the custom natives directory. */
  nativesDirectory?: string;
  /** When true, skip automatic natives patching (persisted only). */
  notPatchNatives?: boolean;
  /** When true, prefer the OS-bundled GLFW/SDL (Linux only). */
  useNativeGlfwSdl?: boolean;
  /** When true, prefer the OS-bundled OpenAL (Linux only). */
  useNativeOpenAL?: boolean;
  /** Launcher window behaviour while the game runs. */
  launcherVisibility?: 'keep' | 'hide' | 'close' | 'hide_and_reopen';
  /** When true, skip the game file completeness check on launch. */
  dontCheckGameCompleteness?: boolean;
  /** Auto-open the launcher log window (persisted only). */
  showLogs?: boolean;
  /** Emit debug-level output (persisted only). */
  enableDebugLogOutput?: boolean;
  /** Allow HMCL to attach a Java agent to modify the game (persisted only). */
  allowAutoAgent?: boolean;
  /** Disable auto-switching the game language (persisted only). */
  disableAutoGameOptions?: boolean;
}

/** Path of the per-instance settings file inside the version root. */
export function instanceSettingsPath(repo: GameRepository, versionId: string): string {
  return join(repo.versionRoot(versionId), '.hmcl', 'config', 'instance-game-settings.json');
}

/** Reads the instance settings file; returns `{}` when absent or malformed. */
export async function readInstanceSettings(
  repo: GameRepository,
  versionId: string
): Promise<InstanceSettings> {
  try {
    const raw = await readFile(instanceSettingsPath(repo, versionId), 'utf8');
    const parsed = JSON.parse(raw) as Partial<InstanceSettings>;
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

/** Writes the instance settings file atomically enough for our purposes. */
export async function writeInstanceSettings(
  repo: GameRepository,
  versionId: string,
  settings: InstanceSettings
): Promise<void> {
  const path = instanceSettingsPath(repo, versionId);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(settings, null, 2), 'utf8');
}

/**
 * The game directory an instance actually uses, and therefore the directory
 * holding its mods, resource packs, shader packs, worlds and saves.
 *
 * Version-isolated instances get their own directory under the version root;
 * every other instance shares the repository root, which is where a vanilla
 * `.minecraft` keeps those files.
 *
 * The addon installer and the instance's folder management both have to agree
 * on this. When they disagreed, installing a resource pack into a global
 * instance wrote it to the shared directory while 资源包管理 listed the version
 * root — so a successful install looked like it had done nothing at all.
 *
 */
export async function resolveGameDir(repo: GameRepository, versionId: string): Promise<string> {
  const settings = await readInstanceSettings(repo, versionId);
  return settings.gameDirType === 'instance' ? repo.versionRoot(versionId) : repo.rootDir;
}

/**
 * Splits a JVM argument string into tokens, honouring double-quoted groups
 * like HMCL's tokenizer.
 */
export function tokenizeArguments(raw: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quoted = false;
  for (const character of raw) {
    if (character === '"') {
      quoted = !quoted;
    } else if (character === ' ' && !quoted) {
      if (current !== '') tokens.push(current);
      current = '';
    } else {
      current += character;
    }
  }
  if (current !== '') tokens.push(current);
  return tokens;
}

/**
 * Parses an environment-variable block written as `KEY=VALUE;KEY2=VALUE2`
 * (semicolons or newlines separate entries). Malformed entries are skipped.
 */
export function parseEnvironmentVariables(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  const parts = raw.split(/[;\n]/);
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed === '') continue;
    const index = trimmed.indexOf('=');
    if (index <= 0) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    if (key === '') continue;
    result[key] = value;
  }
  return result;
}

/**
 * Merges effective instance settings into launch options.
 *
 * @param globalMaxMemory fallback from launcher-wide settings
 * @param globalJava fallback java executable
 */
export function applyInstanceSettings(
  options: LaunchOptions,
  settings: InstanceSettings,
  repo: GameRepository,
  versionId: string,
  globalMaxMemory: number | undefined,
  globalJava: string
): LaunchOptions {
  const merged: LaunchOptions = { ...options };

  if (settings.javaExecutable) merged.javaExecutable = settings.javaExecutable;

  // Version isolation: run with the version root as the game directory so
  // saves and configs stay private to this instance.
  if (settings.gameDirType === 'instance') merged.gameDir = repo.versionRoot(versionId);

  const autoMemory = settings.autoMemory ?? true;
  if (!autoMemory) {
    const max = settings.maxMemory ?? globalMaxMemory;
    if (max !== undefined) merged.maxMemory = max;
    if (settings.minMemory !== undefined) merged.minMemory = settings.minMemory;
  }
  if (settings.permSize !== undefined && settings.permSize > 0) merged.permSize = settings.permSize;

  const args = settings.javaArgs ? tokenizeArguments(settings.javaArgs) : [];
  if (args.length > 0) {
    merged.jvmArguments = [...(merged.jvmArguments ?? []), ...args];
  }

  // Window state: only the windowed mode carries a custom resolution.
  const windowType = settings.windowType ?? (settings.fullscreen ? 'fullscreen' : 'windowed');
  if (windowType === 'fullscreen') {
    merged.fullscreen = true;
  } else if (windowType === 'maximized') {
    merged.maximized = true;
  } else if (settings.width !== undefined && settings.width > 0) {
    merged.width = settings.width;
  }
  if (windowType === 'windowed' && settings.height !== undefined && settings.height > 0) {
    merged.height = settings.height;
  }

  const quickPlay = settings.quickPlay ?? 'none';
  if (quickPlay === 'multiplayer' && settings.server !== undefined && settings.server.trim() !== '') {
    merged.quickPlay = 'multiplayer';
    merged.server = settings.server.trim();
  } else if (quickPlay === 'singleplayer' && settings.quickPlayWorld !== undefined && settings.quickPlayWorld.trim() !== '') {
    merged.quickPlay = 'singleplayer';
    merged.quickPlayWorld = settings.quickPlayWorld.trim();
  } else if (quickPlay === 'realms') {
    merged.quickPlay = 'realms';
  }

  const gameArgs = settings.gameArguments ? tokenizeArguments(settings.gameArguments) : [];
  if (gameArgs.length > 0) {
    merged.gameArguments = [...(merged.gameArguments ?? []), ...gameArgs];
  }

  if (settings.environmentVariables !== undefined && settings.environmentVariables.trim() !== '') {
    merged.environmentVariables = {
      ...(merged.environmentVariables ?? {}),
      ...parseEnvironmentVariables(settings.environmentVariables)
    };
  }

  if (settings.processPriority !== undefined && settings.processPriority !== 'normal') {
    merged.processPriority = settings.processPriority;
  }

  const wrapper = settings.wrapper?.trim() ?? '';
  if (wrapper !== '') merged.wrapper = wrapper;

  // Opting out of the optimizing flags is only meaningful from an explicit
  // instance override; the global default keeps them on.
  if (settings.noOptimizingJVMArgs === true) merged.noGeneratedOptimizingJVMArgs = true;
  // 不添加默认的 Java 虚拟机参数: drop every launcher-supplied default.
  if (settings.noJvmArgs === true) merged.noGeneratedJvmArgs = true;

  // Custom natives bypass the extraction step and rebind ${natives_directory}.
  if (
    settings.useCustomNatives === true &&
    settings.nativesDirectory !== undefined &&
    settings.nativesDirectory.trim() !== ''
  ) {
    merged.nativesDirectoryOverride = settings.nativesDirectory.trim();
  }
  // Pre/post launch shell hooks (HMCL 自定义命令).
  if (settings.precallCommand !== undefined && settings.precallCommand.trim() !== '') {
    merged.preLaunchCommand = settings.precallCommand.trim();
  }
  if (settings.postExitCommand !== undefined && settings.postExitCommand.trim() !== '') {
    merged.postExitCommand = settings.postExitCommand.trim();
  }
  if (settings.dontCheckGameCompleteness === true) merged.skipGameCompletenessCheck = true;
  // Native GLFW/OpenAL bindings on Linux (环境变量 hint, HMCL does likewise).
  if (settings.useNativeGlfwSdl === true) {
    merged.environmentVariables = { ...(merged.environmentVariables ?? {}), LWJGL_NATIVE_GLFW: 'true' };
  }
  if (settings.useNativeOpenAL === true) {
    merged.environmentVariables = { ...(merged.environmentVariables ?? {}), LWJGL_NATIVE_OPENAL: 'true' };
  }

  return merged;
}
