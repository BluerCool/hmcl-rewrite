/**
 * Electron main process: owns the @hmcl/core services, persists settings
 * and bridges everything to the renderer over IPC.
 */
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { basename, dirname, extname, join } from 'node:path';
import { cp, chmod, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { inflateRawSync } from 'node:zlib';
import { totalmem } from 'node:os';
import {
  AccountStore,
  BmclapiDownloadProvider,
  CURRENT_OS,
  Downloader,
  GameRepository,
  Launcher,
  MojangDownloadProvider,
  applyInstanceSettings,
  buildLaunchCommand,
  chainManifests,
  cleanNativesDirectory,
  createOfflineProfile,
  deriveInstanceIcon,
  detectJavaRuntimes,
  downloadAddonFile,
  enabledResourcePacks,
  encodeLaunchScript,
  exportModrinthMrpack,
  extractNatives,
  fetchFabricLoaders,
  fetchForgeBuilds,
  fetchModrinthCategories,
  fetchModrinthVersions,
  fetchNeoForgeBuilds,
  fetchOptiFineBuilds,
  findBuild,
  installFabricVersion,
  installForgeVersion,
  installModpackFile,
  installNeoForgeVersion,
  installOptiFineVersion,
  installVanillaVersion,
  modpackSourceOf,
  parseInstanceIconType,
  optiFineLoaderId,
  packCompatibilityNote,
  parseOptiFineLoaderId,
  primaryFileOf,
  readInstanceSettings,
  readGameOptions,
  readPackMetadata,
  requiredResourceFormat,
  renderLaunchScript,
  resolveLoaderComponents,
  rootGameVersion,
  scriptFlavour,
  searchModrinthProjects,
  setResourcePackEnabled,
  suggestedExportInfo,
  suggestScriptName,
  supportsNewOptionsFormat,
  writeGameOptions,
  writeInstanceSettings,
  type AuthInfo,
  type DownloadProvider,
  type InstanceSettings,
  type LaunchOptions,
  type ModrinthCategory,
  type ModrinthFile,
  type ModrinthProject,
  type ModrinthProjectType,
  type ModrinthVersion,
  type ResolvedVersion,
  type RunningGame
} from '@hmcl/core';
import { LogWindowController, type OutputRow } from './log-window.js';
import type {
  AccountDto,
  AddonSubdir,
  InstanceFolderEntryDto,
  InstanceSettingsDto,
  LoaderKind,
  ModpackExportInfoDto,
  ModpackInspectDto,
  ModrinthCategoryDto,
  ModrinthSearchIndex,
  ModrinthProjectDto,
  ModrinthVersionDto,
  SettingsDto
} from '@hmcl/shared';

// Linux needs this switch so the compositor can composite an ARGB window.
// Without it the transparent window degrades to an opaque black-topped frame.
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('enable-transparent-visuals');
}

const DEFAULT_SETTINGS: SettingsDto = {
  playerName: 'Player',
  gameDir: '',
  maxMemory: 4096,
  minMemory: undefined,
  autoMemory: undefined,
  javaExecutable: undefined as string | undefined,
  javaArgs: undefined,
  gameDirType: undefined,
  downloadMirror: 'bmclapi',
  modrinthMirrorRoot: undefined as string | undefined,
  selectedAccountId: undefined as string | undefined,
  microsoftClientId: undefined as string | undefined,
  themeColor: undefined as string | undefined,
  themeBackground: undefined as string | undefined,
  aprilFools: undefined as boolean | undefined,
  updateChannel: undefined as 'stable' | 'dev' | undefined,
  launcherBackgroundTransparent: undefined as boolean | undefined,
  selectedInstanceId: undefined as string | undefined,
  lastLaunchedId: undefined as string | undefined,
  fileDownloadSource: undefined,
  defaultAddonSource: undefined,
  commonDirectory: undefined,
  commonDirectoryType: undefined,
  autoDownloadThreads: undefined,
  downloadThreads: undefined,
  useProxy: undefined,
  proxyHost: undefined,
  proxyPort: undefined,
  proxyType: undefined,
  proxyAuth: undefined,
  proxyUsername: undefined,
  proxyPassword: undefined,
  language: undefined,
  logLines: undefined
};

/** Application state held by the main process. */
class AppState {
  settings: SettingsDto = { ...DEFAULT_SETTINGS };
  readonly accounts = new AccountStore(join(app.getPath('userData'), 'accounts.json'));
  readonly runningLaunches = new Map<number, AbortController>();
  /**
   * Games that have been spawned, keyed by launch id.
   *
   * A launch id covers both the preparation and the run, and only the second
   * half has a process to end — the abort controllers above stop downloads,
   * these stop a running JVM.
   */
  readonly runningGames = new Map<number, RunningGame>();
  /** Launches the user asked to end, so their exit is not read as a crash. */
  readonly stoppedLaunches = new Set<number>();
  launchIdCounter = 1;

  /** Allocates a monotonically increasing launch id. */
  allocateLaunchId(): number {
    return this.launchIdCounter++;
  }

  settingsFile(): string {
    return join(app.getPath('userData'), 'settings.json');
  }

  async loadSettings(): Promise<void> {
    try {
      const raw = await readFile(this.settingsFile(), 'utf8');
      this.settings = { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<SettingsDto>) };
    } catch {
      // First run or unreadable file: keep defaults.
    }
    if (this.settings.gameDir === '') {
      this.settings.gameDir = join(app.getPath('userData'), '.minecraft');
    }
    logWindow.setLimit(this.settings.logLines ?? DEFAULT_LOG_LINES);
    await this.accounts.load();
  }

  async saveSettings(): Promise<SettingsDto> {
    await mkdir(app.getPath('userData'), { recursive: true });
    await writeFile(this.settingsFile(), JSON.stringify(this.settings, null, 2), 'utf8');
    return this.settings;
  }

  repository(): GameRepository {
    return new GameRepository(this.settings.gameDir);
  }

  provider(): DownloadProvider {
    if (this.settings.downloadMirror === 'bmclapi') {
      return new BmclapiDownloadProvider(undefined, this.settings.modrinthMirrorRoot);
    }
    return new MojangDownloadProvider();
  }

  /** Resolves the account used for launching (selected account or offline). */
  selectedAccount() {
    const selected = this.settings.selectedAccountId
      ? this.accounts.find(this.settings.selectedAccountId)
      : undefined;
    if (selected !== undefined) return selected;
    const firstOffline = this.accounts.list().find((account) => account.kind === 'offline');
    if (firstOffline !== undefined) return firstOffline;
    return undefined;
  }
}

const state = new AppState();

/**
 * HMCL's default when `logLines` is unset (Log.DEFAULT_LOG_LINES); also the
 * starting cap for the log buffer.
 */
const DEFAULT_LOG_LINES = 2000;

/** Default window paint, matching the light monet surface until the renderer loads. */
const DEFAULT_WINDOW_BACKGROUND = '#fbf8ff';

/** Applies the translucent/opaque window paint according to the stored setting. */
function applyWindowTransparency(): void {
  const transparent = state.settings.launcherBackgroundTransparent === true;
  win?.setBackgroundColor(transparent ? '#00000000' : DEFAULT_WINDOW_BACKGROUND);
}

/** The single launcher window, used by the renderer-facing window controls. */
let win: BrowserWindow | null = null;

/**
 * The session log and its window. `runningGames` is the source of truth for
 * which launch is up, so the window's 结束游戏进程 button cannot go stale.
 */
const logWindow = new LogWindowController(
  broadcast,
  () => [...state.runningGames.keys()].at(-1)
);

function createWindow(): void {
  win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 800,
    minHeight: 560,
    title: 'HMCL Rewrite',
    frame: false,
    transparent: true,
    backgroundColor: DEFAULT_WINDOW_BACKGROUND,
    webPreferences: {
      // electron-vite emits ESM preloads (.mjs) when the package type is module.
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  win.on('maximize', () => broadcast({ kind: 'window-maximized', maximized: true }));
  win.on('unmaximize', () => broadcast({ kind: 'window-maximized', maximized: false }));

  if (process.env.ELECTRON_RENDERER_URL !== undefined) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

/**
 * Sends an event to every window. Output rows are filed into the log buffer on
 * the way through, so no producer can forget to log by routing around here.
 */
function broadcast(event: unknown): void {
  const typed = event as { kind?: string } | null;
  // The filed row carries the sequence number the log window dedupes on, so it
  // travels with the event instead of being recomputed on the far side.
  const payload = typed?.kind === 'output' ? { ...typed, ...logWindow.record(event as OutputRow) } : event;
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('hmcl:event', payload);
  }
}

type IpcHandler = (...args: never[]) => unknown | Promise<unknown>;

function handle(channel: string, handler: IpcHandler): void {
  ipcMain.handle(channel, (_event, ...args) => handler(...(args as never[])));
}

handle('versions:list', async () => {
  const repo = state.repository();
  const versions = await repo.listInstalledVersions();
  const manifests = new Map(versions.map((version) => [version.id, version.manifest]));
  return Promise.all(
    versions.map(async (version) => {
      const gameVersion = rootGameVersion(version.id, manifests);
      const loaders = resolveLoaderComponents(chainManifests(version.id, manifests), gameVersion);
      const settings = await readInstanceSettings(repo, version.id);
      const customIcon = (await instanceIconPath(repo, version.id)) !== undefined;
      return {
        id: version.id,
        jar: version.manifest.jar ?? version.id,
        type: version.manifest.type,
        gameVersion,
        loaders,
        isolated: settings.gameDirType === 'instance',
        modpack: modpackSourceOf(version.manifest) ?? undefined,
        icon: deriveInstanceIcon({
          setting: settings.icon,
          hasIconFile: customIcon,
          loaders: loaders.map((loader) => loader.slug),
          // HMCL asks its component analyser whether OptiFine is there. Nothing
          // indexes the components here, and every OptiFine instance HMCL builds
          // is named after its OptiFine jar, so the id carries the answer.
          hasOptiFine: /optifine/i.test(version.id),
          gameVersion
        }),
        customIcon
      };
    })
  );
});

handle('versions:remote', async () => {
  const provider = state.provider();
  const response = await fetch(provider.versionManifestUrl);
  if (!response.ok) throw new Error(`Manifest fetch failed: HTTP ${response.status}`);
  const manifest = (await response.json()) as {
    versions: { id: string; type: string; releaseTime: string }[];
  };
  return manifest.versions.map((entry) => ({
    id: entry.id,
    type: entry.type,
    releaseTime: entry.releaseTime
  }));
});

handle('versions:install', async (id: string) => {
  const launchId = -1;
  try {
    await installVanillaVersion(
      state.repository(),
      state.provider(),
      String(id),
      (progress) => broadcast({ kind: 'download-progress', launchId, progress }),
      (stage) => broadcast({ kind: 'stage', launchId, stage })
    );
    broadcast({ kind: 'download-settled', launchId, ok: true });
  } catch (e) {
    broadcast({ kind: 'download-settled', launchId, ok: false, error: String(e) });
    throw e;
  }
});

handle('java:detect', async () => {
    const runtimes = await detectJavaRuntimes();
    return runtimes.map((runtime) => ({
      executable: runtime.executable,
      majorVersion: runtime.majorVersion,
      versionString: runtime.versionString
    }));
  });

  handle('java:pick-executable', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择 Java 可执行文件',
      properties: ['openFile'],
      filters: [
        { name: 'Java Executable', extensions: ['exe', 'bin'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    });
    if (result.canceled || result.filePaths.length === 0) return undefined;
    return result.filePaths[0];
  });

  handle('system:memory', async () => {
    const totalMem = totalmem();
    return Math.floor(totalMem / (1024 * 1024));
  });

handle('loaders:list', async (kind: LoaderKind, mcVersion: string) => {
  if (kind === 'fabric') {
    const loaders = await fetchFabricLoaders(state.provider(), mcVersion);
    return loaders.map((entry) => ({
      id: entry.version,
      kind: 'fabric' as const,
      label: entry.version,
      stable: entry.stable
    }));
  }
  if (kind === 'forge') {
    const builds = await fetchForgeBuilds(mcVersion);
    return builds.map((build) => ({
      id: String(build.build),
      kind: 'forge' as const,
      label: `${build.version}${build.recommended ? '(推荐)' : ''}`,
      stable: build.recommended
    }));
  }
  if (kind === 'neoforge') {
    const builds = await fetchNeoForgeBuilds(mcVersion);
    return builds
      .reverse()
      .slice(0, 60)
      .map((build) => ({
        id: build.version,
        kind: 'neoforge' as const,
        label: build.version,
        stable: !build.version.includes('-')
      }));
  }
  const builds = await fetchOptiFineBuilds(mcVersion);
  return builds
    .reverse()
    .map((build) => ({
      id: optiFineLoaderId(build),
      kind: 'optifine' as const,
      label: `${build.type}${build.patch === '' ? '' : ` ${build.patch}`}`,
      stable: build.stable
    }));
});

handle('loaders:install', async (kind: LoaderKind, mcVersion: string, loaderId: string) => {
  const launchId = -1;
  try {
    const repo = state.repository();
    const provider = state.provider();
    const java = state.settings.javaExecutable ?? (await pickJava(undefined)) ?? 'java';
    const onLine = (line: string): void => logWindow.publish(launchId, line, false);

    let createdId: string;
    switch (kind) {
      case 'fabric':
        createdId = await installFabricVersion(repo, provider, mcVersion, loaderId);
        break;
      case 'forge': {
        broadcast({ kind: 'stage', launchId, stage: 'installing-forge' });
        const build = findBuild(await fetchForgeBuilds(mcVersion), Number(loaderId));
        createdId = await installForgeVersion(
          repo,
          provider,
          mcVersion,
          build.version,
          build.branch,
          build.build,
          java,
          onLine
        );
        break;
      }
      case 'neoforge':
        broadcast({ kind: 'stage', launchId, stage: 'installing-neoforge' });
        createdId = await installNeoForgeVersion(repo, provider, mcVersion, loaderId, java, onLine);
        break;
      case 'optifine': {
        broadcast({ kind: 'stage', launchId, stage: 'installing-optifine' });
        const { type, patch } = parseOptiFineLoaderId(loaderId);
        createdId = await installOptiFineVersion(repo, provider, mcVersion, type, patch, java, onLine);
        break;
      }
    }

    // Prefetch shared game files (libraries/assets) for the new instance.
    const resolved = await repo.resolveInstalledVersion(createdId);
    await new Launcher(repo, provider).ensureGameFiles(resolved, (progress) =>
      broadcast({ kind: 'download-progress', launchId, progress })
    );
    // Loader installs announce a stage but never cleared it, so the footer kept
    // saying 正在安装 Forge long after the install was done.
    broadcast({ kind: 'stage', launchId, stage: 'idle' });
    broadcast({ kind: 'download-settled', launchId, ok: true });
    return createdId;
  } catch (e) {
    broadcast({ kind: 'stage', launchId, stage: 'idle' });
    broadcast({ kind: 'download-settled', launchId, ok: false, error: String(e) });
    throw e;
  }
});

handle('settings:get', () => state.settings);

handle('settings:save', async (partial: Partial<SettingsDto>) => {
  state.settings = { ...state.settings, ...partial };
  return state.saveSettings();
});

/**
 * Picks a background image via dialog and copies it into userData so the
 * setting stays valid even if the source file moves. Resolves undefined on
 * cancel.
 */
handle('theme:pick-background', async () => {
  const result = await dialog.showOpenDialog({
    title: '选择背景图',
    properties: ['openFile'],
    filters: [
      { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] },
      { name: '所有文件', extensions: ['*'] }
    ]
  });
  if (result.canceled || result.filePaths.length === 0) return undefined;
  const source = result.filePaths[0];
  if (source === undefined) return undefined;
  const target = join(app.getPath('userData'), `theme-background${extname(source).toLowerCase()}`);
  await mkdir(app.getPath('userData'), { recursive: true });
  await cp(source, target, { force: true });
  return target;
});

const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp'
};

/** Reads an image into a data URL so the renderer never needs file access. */
handle('theme:read-background', async (path: string | undefined) => {
  if (path === undefined) return undefined;
  const mime = IMAGE_MIME[extname(path).toLowerCase()];
  if (mime === undefined) return undefined;
  const data = await readFile(path);
  if (data.byteLength > 25 * 1024 * 1024) throw new Error('背景图过大（超过 25 MiB）');
  return `data:${mime};base64,${data.toString('base64')}`;
});

/** Toggles whether the OS window itself is translucent. */
handle('theme:set-background-transparent', async (enabled: boolean) => {
  state.settings.launcherBackgroundTransparent = enabled === true ? true : undefined;
  applyWindowTransparency();
});

/** Reasserts the window background so a stale opaque layer is repainted. */
handle('theme:fix-background-transparency', async () => {
  applyWindowTransparency();
});

/** Where exported launcher logs are written. */
function launcherLogDir(): string {
  return join(app.getPath('userData'), 'logs');
}

/** Writes the session log to userData/logs and reveals it in the file manager. */
handle('logs:export', async () => {
  const dir = launcherLogDir();
  await mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = join(dir, `launcher-${stamp}.log`);
  await writeFile(target, logWindow.snapshot().lines.map((line) => line.text).join('\n'), 'utf8');
  shell.showItemInFolder(target);
  return target;
});

/** Reveals the log folder, mirroring HMCL's 通用 → 杂项 → 调试 row. */
handle('logs:open-folder', async () => {
  const dir = launcherLogDir();
  await mkdir(dir, { recursive: true });
  const error = await shell.openPath(dir);
  if (error !== '') throw new Error(error);
});

handle('logs:open-window', () => {
  logWindow.open();
});

handle('logs:snapshot', () => logWindow.snapshot());

/** Files a launcher-side message on the same channel as game output. */
handle('logs:append', (line: { text: string; isError: boolean }) => {
  logWindow.publish(-1, line.text, line.isError);
});

handle('logs:clear', () => {
  logWindow.clear();
  // Told to the windows rather than patched locally: main owns the buffer, and
  // an open log window has to drop its rows at the same instant it goes empty.
  broadcast({ kind: 'log-cleared' });
});

handle('logs:always-on-top', (alwaysOnTop: boolean) => {
  logWindow.setAlwaysOnTop(alwaysOnTop);
});

/** Changes how many rows the buffer keeps, persisting it as the `logLines` setting. */
handle('logs:set-lines', async (count: number) => {
  logWindow.setLimit(count);
  state.settings.logLines = count;
  return state.saveSettings();
});

/**
 * Thread dump of the running game, the counterpart of HMCL's 导出游戏运行栈.
 * Uses the JDK that launched the game, so the dump matches what it is running.
 */
handle('logs:dump-stack', async () => {
  const launchId = [...state.runningGames.keys()].at(-1);
  const game = launchId === undefined ? undefined : state.runningGames.get(launchId);
  if (game === undefined || game.pid === undefined) throw new Error('游戏未在运行');
  const javaPath = game.command.argv[0];
  if (javaPath === undefined) throw new Error('找不到启动游戏所用的 Java');
  const jstack = join(dirname(javaPath), process.platform === 'win32' ? 'jstack.exe' : 'jstack');

  const dump = await new Promise<string>((resolve, reject) => {
    execFile(jstack, [String(game.pid)], { maxBuffer: 32 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error !== null) reject(new Error(stderr.trim() === '' ? error.message : stderr.trim()));
      else resolve(stdout);
    });
  });

  const dir = join(app.getPath('userData'), 'logs');
  await mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = join(dir, `jstack-${stamp}.log`);
  await writeFile(target, dump, 'utf8');
  shell.showItemInFolder(target);
  return target;
});

/**
 * Everything `launch:start` and `launch:save-script` both need: the resolved
 * version, the credentials to launch it with, and the options after the global
 * settings have been overlaid with the instance's own.
 */
async function resolveLaunchPlan(versionId: string): Promise<{
  repo: GameRepository;
  resolved: ResolvedVersion;
  auth: AuthInfo;
  options: LaunchOptions;
}> {
  const repo = state.repository();
  const resolved: ResolvedVersion = await repo.resolveInstalledVersion(versionId);

  // Resolve credentials from the selected account (falls back to offline).
  const account = state.selectedAccount();
  const auth =
    account !== undefined
      ? await state.accounts.getCredentials(account, state.settings.microsoftClientId ?? '')
      : createOfflineProfile(state.settings.playerName);

  // Effective options: global settings overlaid with per-instance overrides.
  const javaExecutable = state.settings.javaExecutable ?? (await pickJava(resolved)) ?? 'java';
  const launchOptions: LaunchOptions = {
    javaExecutable,
    javaMajorVersion: 17,
    gameDir: state.settings.gameDir
  };
  if (state.settings.maxMemory !== undefined) {
    launchOptions.maxMemory = state.settings.maxMemory;
  }
  const instanceSettings = await readInstanceSettings(repo, versionId);
  return {
    repo,
    resolved,
    auth,
    options: applyInstanceSettings(
      launchOptions,
      instanceSettings,
      repo,
      versionId,
      state.settings.maxMemory,
      javaExecutable
    )
  };
}

handle('launch:start', async (versionId: string) => {
  const launchId = state.allocateLaunchId();
  const abort = new AbortController();
  state.runningLaunches.set(launchId, abort);

  // Remember the launched instance so the next app open defaults to it.
  state.settings.lastLaunchedId = versionId;
  void state.saveSettings();

  const { repo, resolved, auth, options: effectiveOptions } = await resolveLaunchPlan(versionId);
  const launcher = new Launcher(repo, state.provider());
  const instanceSettings = await readInstanceSettings(repo, versionId);

  // 启动器可见性: keep/hide/close/hide_and_reopen once the game runs.
  const visibility = instanceSettings.launcherVisibility;
  const reopenOnExit = visibility === 'hide_and_reopen';
  const onLauncherEvent = (event: { type: string; code?: number | null; [key: string]: unknown }): void => {
    if (event.type === 'exit' && reopenOnExit && win !== null && !win.isDestroyed()) {
      win.show();
    }
    // A game killed on request exits with no code, which the renderer would
    // otherwise report as a crash the user never caused.
    const stopped = event.type === 'exit' && state.stoppedLaunches.has(launchId);
    if (event.type === 'exit') {
      // The launch promise settled when the process was spawned, so this is
      // the first moment the game is really over.
      state.runningGames.delete(launchId);
      state.stoppedLaunches.delete(launchId);
    }
    broadcast({ kind: event.type, launchId, ...(event as object), stopped });
  };

  void launcher
    .launch(resolved, auth, effectiveOptions, (event) => onLauncherEvent(event as { type: string }))
    .then((game) => {
      state.runningGames.set(launchId, game);
      // HMCL pops the log window the moment the process appears
      // (LauncherHelper.java:873), gated by the instance's 显示日志 setting.
      if (instanceSettings.showLogs !== false) logWindow.open();
      if (win !== null) {
        if (reopenOnExit || visibility === 'hide') {
          win.hide();
        } else if (visibility === 'close') {
          win.close();
        }
      }
    })
    .catch((error: unknown) => {
      logWindow.publish(launchId, `Launch failed: ${String(error)}`, true, 'error');
      broadcast({ kind: 'exit', launchId, code: -1 });
    })
    .finally(() => {
      // Only the preparation is over: the promise settles as soon as the
      // process is spawned, so the handle for ending the game has to stay.
      // runningGames is cleared by the exit event instead.
      state.runningLaunches.delete(launchId);
      state.stoppedLaunches.delete(launchId);
    });

  return launchId;
});

handle('launch:cancel', (launchId: number) => {
  const abort = state.runningLaunches.get(launchId);
  if (abort === undefined) return false;
  abort.abort();
  state.runningLaunches.delete(launchId);
  return true;
});

/**
 * Writes a runnable script that starts an instance without the launcher.
 *
 * HMCL's `Instances#generateLaunchScript` runs the same launch pipeline and
 * then writes the command line out instead of spawning it
 * (`DefaultLauncher#makeLaunchScript`). The natives are extracted here for the
 * same reason: the script has no launcher to do it, and it points at the
 * per-version natives directory the launcher would have used.
 *
 * @returns the written path, or `undefined` when the user cancelled the dialog.
 */
handle('launch:save-script', async (versionId: string): Promise<string | undefined> => {
  const { repo, resolved, auth, options } = await resolveLaunchPlan(versionId);
  const command = buildLaunchCommand(repo, resolved, auth, options);
  await cleanNativesDirectory(command.nativesDirectory);
  await extractNatives(repo, resolved, command.nativesDirectory);

  const filters = scriptFilters();
  const saveOptions = {
    title: '保存启动脚本',
    defaultPath: join(command.workingDirectory, suggestScriptName(versionId)),
    filters
  };
  const parent = win;
  // The parent may already be gone if the user closed the window while the plan
  // was being resolved; the dialog then opens parentless instead of failing.
  const result =
    parent !== null && !parent.isDestroyed()
      ? await dialog.showSaveDialog(parent, saveOptions)
      : await dialog.showSaveDialog(saveOptions);
  if (result.canceled || result.filePath === undefined || result.filePath === '') return undefined;

  const flavour = scriptFlavour(extname(result.filePath));
  const windows = CURRENT_OS === 'windows';
  const text = renderLaunchScript(command.argv, command.workingDirectory, flavour, {
    preLaunchCommand: options.preLaunchCommand,
    windows
  });
  await writeFile(result.filePath, encodeLaunchScript(text, flavour, windows));
  if (flavour !== 'ps1') {
    // Finder and the Linux file managers run a script by its executable bit,
    // which a freshly written file does not have.
    await chmod(result.filePath, 0o755).catch(() => undefined);
  }
  shell.showItemInFolder(result.filePath);
  return result.filePath;
});

/**
 * The save-dialog filters for a launch script.
 *
 * HMCL lists one filter per extension, and only offers `.command` on macOS
 * (`Instances.generateLaunchScript:290-300`). `.bash` is accepted when saving
 * but never offered, so it is absent here too.
 */
function scriptFilters(): Array<{ name: string; extensions: string[] }> {
  const filters: Array<{ name: string; extensions: string[] }> = [];
  if (CURRENT_OS === 'macos') filters.push({ name: 'macOS Shell 脚本', extensions: ['command'] });
  filters.push(
    CURRENT_OS === 'windows'
      ? { name: 'Windows 脚本', extensions: ['bat'] }
      : { name: 'Bash 脚本', extensions: ['sh'] }
  );
  filters.push({ name: 'PowerShell 脚本', extensions: ['ps1'] });
  return filters;
}

/**
 * Ends a running game. Answers `false` when there is nothing to end, which is
 * the normal case before the process is spawned and after it has exited.
 */
handle('launch:stop', async (launchId: number) => {
  const game = state.runningGames.get(launchId);
  if (game === undefined) return false;
  state.stoppedLaunches.add(launchId);
  await game.stop();
  return true;
});

/** Opens an https URL in the system browser (used for wiki links). */
handle('shell:open-external', (url: string) => {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') throw new Error(`Refusing to open ${parsed.protocol} URLs`);
  return shell.openExternal(url).then(() => undefined);
});

// ============ Modrinth & addon downloads ============

/** Broadcasts install/download progress on the global -1 launch channel. */
function broadcastInstallProgress(progress: unknown): void {
  broadcast({ kind: 'download-progress', launchId: -1, progress });
}

handle('modrinth:search', async (
  type: ModrinthProjectType,
  query: string | undefined,
  gameVersion: string | undefined,
  categories: string[] | undefined,
  index: ModrinthSearchIndex | undefined,
  offset: number | undefined,
  limit: number | undefined
) => {
  const result = await searchModrinthProjects({
    type,
    query: query === undefined || query === '' ? undefined : query,
    gameVersion: gameVersion === undefined || gameVersion === '' ? undefined : gameVersion,
    categories: categories === undefined ? [] : categories,
    index,
    offset,
    limit
  });
  return {
    totalHits: result.totalHits,
    projects: result.projects.map(toModrinthProjectDto)
  };
});

handle('modrinth:categories', async (type: ModrinthProjectType): Promise<ModrinthCategoryDto[]> => {
  const categories = await fetchModrinthCategories(type);
  return categories.map(toModrinthCategoryDto);
});

handle('modrinth:versions', async (projectIdOrSlug: string) => {
  const versions = await fetchModrinthVersions(projectIdOrSlug);
  return versions.map((version) => toModrinthVersionDto(version));
});

handle('addon:download', async (
  instanceId: string,
  subdir: AddonSubdir,
  version: ModrinthVersionDto
) => {
  const launchId = -1;
  try {
    const repo = state.repository();
    await assertInstanceExists(repo, instanceId);
    // The renderer shows a footer while this downloads, so it needs a stage to
    // name. Without one it sat on whatever the status line said before — 空闲
    // for an install that was plainly in progress.
    broadcast({ kind: 'stage', launchId, stage: `installing-${subdir}` });
    await downloadAddonFile(repo, state.provider(), instanceId, subdir, toCoreModrinthVersion(version), (p) =>
      broadcast({ kind: 'download-progress', launchId, progress: p })
    );
    broadcast({ kind: 'stage', launchId, stage: 'idle' });
    broadcast({ kind: 'download-settled', launchId, ok: true });
  } catch (e) {
    broadcast({ kind: 'stage', launchId, stage: 'idle' });
    broadcast({ kind: 'download-settled', launchId, ok: false, error: String(e) });
    throw e;
  }
});

handle('addon:save-file', async (url: string, filename: string) => {
  const provider = state.provider();
  const result = await dialog.showSaveDialog({
    title: '另存为',
    defaultPath: join(app.getPath('downloads'), basename(String(filename)))
  });
  if (result.canceled || result.filePath === undefined) return false;
  await new Downloader({ concurrency: provider.concurrency, onProgress: broadcastInstallProgress })
    .downloadAll([
      {
        url: String(url),
        destination: result.filePath,
        altUrls: provider.altUrls(String(url))
      }
    ]);
  return true;
});

/**
 * Reads a single entry out of a ZIP buffer through its central directory,
 * inflating with node's built-in zlib. Only the strictly needed local bytes
 * are touched, so large pack files stay cheap to inspect.
 */
function readZipEntry(buffer: Buffer, entryName: string): Buffer | undefined {
  const searchLimit = Math.min(buffer.length, 65557);
  let eocd = -1;
  for (let cursor = buffer.length - 22; cursor >= buffer.length - searchLimit; cursor -= 1) {
    if (buffer.readUInt32LE(cursor) === 0x06054b50) {
      eocd = cursor;
      break;
    }
  }
  if (eocd === -1) return undefined;

  const entryCount = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const wanted = entryName.toLowerCase();
  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) return undefined;
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    if (name.toLowerCase() === wanted) {
      // Local file header sits at `localOffset`; its data follows the name+extra fields.
      if (buffer.readUInt32LE(localOffset) !== 0x04034b50) return undefined;
      const localNameLength = buffer.readUInt16LE(localOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      const raw = buffer.subarray(dataStart, dataStart + compressedSize);
      if (method === 0) return Buffer.from(raw);
      if (method === 8) {
        try {
          return inflateRawSync(raw);
        } catch {
          return undefined;
        }
      }
      return undefined;
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return undefined;
}

// ============ Modpack installs ============

/** Resolves a Java runtime for Forge/NeoForge installer scripts. */
async function resolveJava(): Promise<string | undefined> {
  return state.settings.javaExecutable ?? (await pickJava(undefined));
}

handle('modpack:pick', async () => {
  const result = await dialog.showOpenDialog({
    title: '选择要安装的游戏整合包文件',
    filters: [{ name: '整合包', extensions: ['zip', 'mrpack'] }],
    properties: ['openFile']
  });
  return result.canceled ? undefined : result.filePaths[0];
});

handle('modpack:inspect', async (path: string) => {
  const buffer = await readFile(String(path));
  const indexEntry = readZipEntry(buffer, 'modrinth.index.json');
  const manifestEntry = indexEntry === undefined ? readZipEntry(buffer, 'manifest.json') : undefined;
  const fallback: ModpackInspectDto = { fileName: basename(String(path)), name: undefined, version: undefined, author: undefined, summary: undefined };
  if (indexEntry === undefined && manifestEntry === undefined) return fallback;

  if (indexEntry !== undefined) {
    const parsed = JSON.parse(indexEntry.toString('utf8')) as { name?: unknown; versionId?: unknown; summary?: unknown };
    return {
      fileName: fallback.fileName,
      name: typeof parsed.name === 'string' ? parsed.name : undefined,
      version: typeof parsed.versionId === 'string' ? parsed.versionId : undefined,
      author: undefined,
      summary: typeof parsed.summary === 'string' ? parsed.summary : undefined
    };
  }

  const parsed = JSON.parse(manifestEntry!.toString('utf8')) as {
    name?: unknown;
    version?: unknown;
    author?: unknown;
  };
  return {
    fileName: fallback.fileName,
    name: typeof parsed.name === 'string' ? parsed.name : undefined,
    version: typeof parsed.version === 'string' ? parsed.version : undefined,
    author: typeof parsed.author === 'string' ? parsed.author : undefined,
    summary: undefined
  };
});

handle('modpack:install-file', async (path: string, instanceName: string) => {
  const launchId = -1;
  try {
    const installed = await installModpackFile(
      state.repository(), state.provider(), String(path), String(instanceName), {
        java: await resolveJava(),
        onProgress: (p) => broadcast({ kind: 'download-progress', launchId, progress: p }),
        onLine: (line) => logWindow.publish(launchId, line, false)
      }
    );
    broadcast({ kind: 'download-settled', launchId, ok: true });
    return installed;
  } catch (e) {
    broadcast({ kind: 'download-settled', launchId, ok: false, error: String(e) });
    throw e;
  }
});

handle('modpack:install-modrinth', async (projectId: string, versionId: string, instanceName: string) => {
  const launchId = -1;
  try {
    const repo = state.repository();
    const provider = state.provider();

    // Resolve the chosen version and its primary .mrpack file.
    const versions = await fetchModrinthVersions(String(projectId));
    const version = versions.find((entry) => entry.id === versionId);
    if (version === undefined) throw new Error('未找到该整合包版本');
    const packFile = version.files.find((file) => file.filename.endsWith('.mrpack')) ?? primaryFileOf(version);
    if (packFile === undefined) throw new Error('该整合包没有可下载的文件');

    const tempDir = join(app.getPath('temp'), `hmcl-modrinth-${instanceName}`);
    await mkdir(tempDir, { recursive: true });
    const target = join(tempDir, packFile.filename);

    // Wrap download with a 30-minute timeout to prevent indefinite stalls
    const downloadTimeoutMs = 30 * 60 * 1000;
    await Promise.race([
      new Downloader({ concurrency: provider.concurrency, onProgress: (p) =>
        broadcast({ kind: 'download-progress', launchId, progress: p })
      })
        .downloadAll([
          {
            url: packFile.url,
            destination: target,
            sha1: packFile.sha1,
            size: packFile.size,
            altUrls: provider.altUrls(packFile.url)
          }
        ]),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('下载超时（30分钟），请检查网络后重试')), downloadTimeoutMs)
      )
    ]);

    let installed: string;
    try {
      installed = await installModpackFile(state.repository(), provider, target, String(instanceName), {
        java: await resolveJava(),
        // Recorded so the instance list can offer this pack's other versions
        // later. No modpack format states its own project, so this is the only
        // moment the id is known.
        projectId: String(projectId),
        onProgress: (p) => broadcast({ kind: 'download-progress', launchId, progress: p }),
        onLine: (line) => logWindow.publish(launchId, line, false)
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
    broadcast({ kind: 'download-settled', launchId, ok: true });
    return installed;
  } catch (e) {
    broadcast({ kind: 'download-settled', launchId, ok: false, error: String(e) });
    throw e;
  }
});

handle('modpack:other-versions', async (instanceId: string) => {
  const repo = state.repository();
  await assertInstanceExists(repo, instanceId);
  const installed = (await repo.listInstalledVersions()).find((entry) => entry.id === instanceId);
  const source = installed?.manifest === undefined
    ? undefined
    : modpackSourceOf(installed.manifest);
  // Only a pack this launcher downloaded names the project it came from, and
  // only Modrinth asks for one at all. Anything else has nothing to ask.
  if (source === undefined || source.projectId === undefined) return undefined;
  const versions = await fetchModrinthVersions(source.projectId);
  return {
    projectId: source.projectId,
    name: source.name,
    installedVersion: source.version,
    versions: versions.map((version) => toModrinthVersionDto(version))
  };
});

handle('modpack:export-defaults', async (instanceId: string) => {
  const repo = state.repository();
  await assertInstanceExists(repo, instanceId);
  const installed = (await repo.listInstalledVersions()).find((entry) => entry.id === instanceId);
  return suggestedExportInfo(
    installed?.manifest === undefined ? undefined : modpackSourceOf(installed.manifest),
    instanceId
  );
});

handle('modpack:export', async (instanceId: string, info: ModpackExportInfoDto) => {
  const repo = state.repository();
  await assertInstanceExists(repo, instanceId);

  const name = String(info.name).trim();
  const version = String(info.version).trim();
  if (name === '') throw new Error('请填写整合包名称');
  // HMCL puts a RequiredValidator on both fields (`ModpackInfoPage:220-221`).
  if (version === '') throw new Error('请填写整合包版本');

  const runDirectory = await resolveLaunchGameDir(repo, instanceId);
  const saveOptions = {
    title: '保存整合包',
    defaultPath: join(runDirectory, `${sanitizeFileName(name)}.mrpack`),
    filters: [{ name: '整合包', extensions: ['mrpack'] }]
  };
  const parent = win;
  // The parent may already be gone if the user closed the window while the
  // instance was being inspected; the dialog then opens parentless.
  const result =
    parent !== null && !parent.isDestroyed()
      ? await dialog.showSaveDialog(parent, saveOptions)
      : await dialog.showSaveDialog(saveOptions);
  if (result.canceled || result.filePath === undefined || result.filePath === '') return undefined;

  const exported = await exportModrinthMrpack(
    repo,
    instanceId,
    runDirectory,
    {
      name,
      version,
      summary: blankToUndefined(info.summary)
    },
    result.filePath
  );
  return { path: result.filePath, files: exported.files, bytes: exported.bytes };
});

function blankToUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === '' ? undefined : trimmed;
}

/** Strips the characters a file name cannot carry on any of the three hosts. */
function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[/\\:*?"<>|]/g, '_').trim();
  return cleaned === '' ? 'modpack' : cleaned;
}

// ============ Accounts ============

function toAccountDto(account: { id: string; kind: string; username: string; uuid?: string }): AccountDto {
  return { id: account.id, kind: account.kind as AccountDto['kind'], username: account.username, uuid: account.uuid };
}

function toModrinthProjectDto(project: ModrinthProject): ModrinthProjectDto {
  return {
    slug: project.slug,
    title: project.title,
    description: project.description,
    iconUrl: project.iconUrl,
    author: project.author,
    downloads: project.downloads,
    projectType: project.projectType,
    gameVersions: project.gameVersions,
    categories: project.categories,
    latestVersionNumber: project.latestVersionNumber
  };
}

function toModrinthCategoryDto(category: ModrinthCategory): ModrinthCategoryDto {
  return {
    slug: category.slug,
    name: category.name,
    iconUrl: category.iconUrl === '' ? undefined : category.iconUrl
  };
}

function toModrinthVersionDto(version: ModrinthVersion): ModrinthVersionDto {
  return {
    id: version.id,
    projectId: version.projectId,
    versionNumber: version.versionNumber,
    name: version.name,
    gameVersions: version.gameVersions,
    loaders: version.loaders,
    files: version.files.map((file) => ({
      url: file.url,
      filename: file.filename,
      size: file.size,
      sha1: file.sha1,
      primary: file.primary
    })),
    datePublished: version.datePublished,
    versionType: version.versionType,
    changelogUrl: version.changelogUrl,
    dependencies: version.dependencies.map((dependency) => ({
      projectId: dependency.projectId,
      versionId: dependency.versionId,
      dependencyType: dependency.dependencyType
    }))
  };
}

function toCoreModrinthVersion(dto: ModrinthVersionDto): ModrinthVersion {
  return {
    id: dto.id,
    projectId: dto.projectId,
    versionNumber: dto.versionNumber,
    name: dto.name,
    gameVersions: dto.gameVersions,
    loaders: dto.loaders,
    files: dto.files.map(
      (file): ModrinthFile => ({
        url: file.url,
        filename: file.filename,
        size: file.size,
        sha1: file.sha1,
        primary: file.primary
      })
    ),
    datePublished: dto.datePublished,
    versionType: dto.versionType,
    changelogUrl: dto.changelogUrl,
    dependencies: dto.dependencies.map((dependency) => ({
      projectId: dependency.projectId,
      versionId: dependency.versionId,
      dependencyType: dependency.dependencyType
    }))
  };
}

handle('accounts:list', () => state.accounts.list().map(toAccountDto));

handle('accounts:add-offline', async (username: string, uuid?: string) => {
  const account = await state.accounts.addOffline(String(username), uuid === undefined ? undefined : String(uuid));
  // The newly logged-in account becomes the selected one (as HMCL does).
  state.settings.selectedAccountId = account.id;
  await state.saveSettings();
  return toAccountDto(account);
});

handle('accounts:microsoft-start', async () => {
  const account = await state.accounts.addMicrosoft(state.settings.microsoftClientId ?? '', {
    onDeviceCode: (grant) => {
      broadcast({
        kind: 'microsoft-device-code',
        code: { userCode: grant.userCode, verificationUri: grant.verificationUri }
      });
    },
    onSuccess: (created) => {
      state.settings.selectedAccountId = created.id;
      void state.saveSettings();
      broadcast({ kind: 'microsoft-login-result', ok: true, message: created.username });
    },
    onError: (message) => {
      broadcast({ kind: 'microsoft-login-result', ok: false, message });
    }
  });
  return toAccountDto(account);
});

handle('accounts:microsoft-cancel', () => state.accounts.cancelMicrosoftLogin());

handle('accounts:remove', async (id: string) => {
  await state.accounts.remove(id);
  if (state.settings.selectedAccountId === id) {
    state.settings.selectedAccountId = undefined;
    await state.saveSettings();
  }
});

handle('accounts:select', async (id: string) => {
  if (state.accounts.find(id) === undefined) throw new Error(`Unknown account ${id}`);
  state.settings.selectedAccountId = id;
  await state.saveSettings();
});

handle('accounts:rename', async (id: string, username: string) => {
  const account = await state.accounts.rename(id, username);
  return toAccountDto(account);
});

// ============ Instance management ============

/** Guards version ids used as directory names. */
function assertValidInstanceId(id: string): void {
  if (!/^[0-9A-Za-z._-]+$/.test(id)) throw new Error(`非法实例名:${id}`);
}

async function assertInstanceExists(repo: GameRepository, id: string): Promise<void> {
  const installed = await repo.listInstalledVersions();
  if (!installed.some((version) => version.id === id)) {
    throw new Error(`实例不存在:${id}`);
  }
}

handle('instances:delete', async (id: string) => {
  const repo = state.repository();
  await assertInstanceExists(repo, id);
  await rm(repo.versionRoot(id), { recursive: true, force: true });
});

/**
 * Rewrites the version json inside a moved/copied instance root so its file
 * name and `id` field match the new instance id (mirrors HMCL's draft rename).
 */
async function rebaseVersionJson(
  repo: GameRepository,
  oldId: string,
  targetRoot: string,
  newId: string
): Promise<void> {
  const jsonPath = join(targetRoot, `${oldId}.json`);
  const raw = await readFile(jsonPath, 'utf8');
  const json = JSON.parse(raw) as { id?: string };
  json.id = newId;
  await writeFile(join(targetRoot, `${newId}.json`), JSON.stringify(json), 'utf8');
  if (newId !== oldId) await rm(jsonPath, { force: true });
}

handle('instances:rename', async (oldId: string, newId: string) => {
  const repo = state.repository();
  assertValidInstanceId(newId);
  await assertInstanceExists(repo, oldId);
  const targetRoot = repo.versionRoot(newId);
  try {
    // Probe that the target is free before touching the source.
    await mkdir(targetRoot, { recursive: false });
    await rm(targetRoot, { recursive: true, force: true });
  } catch {
    throw new Error(`实例已存在:${newId}`);
  }
  await rename(repo.versionRoot(oldId), targetRoot);
  try {
    await rebaseVersionJson(repo, oldId, targetRoot, newId);
  } catch (error) {
    // Roll the move back so the launcher never loses an instance.
    await rename(targetRoot, repo.versionRoot(oldId));
    throw error;
  }
});

handle('instances:copy', async (sourceId: string, newId: string) => {
  const repo = state.repository();
  assertValidInstanceId(newId);
  await assertInstanceExists(repo, sourceId);
  const targetRoot = repo.versionRoot(newId);
  try {
    await mkdir(targetRoot, { recursive: false });
    await rm(targetRoot, { recursive: true, force: true });
  } catch {
    throw new Error(`实例已存在:${newId}`);
  }
  await cp(repo.versionRoot(sourceId), targetRoot, { recursive: true });
  try {
    await rebaseVersionJson(repo, sourceId, targetRoot, newId);
  } catch (error) {
    await rm(targetRoot, { recursive: true, force: true });
    throw error;
  }
});

// ============ Per-instance settings ============

handle('instance-settings:get', (id: string) =>
  readInstanceSettings(state.repository(), id)
);

handle('instance-settings:set', async (id: string, settings: InstanceSettingsDto) => {
  const repo = state.repository();
  await assertInstanceExists(repo, id);
  // Only persist known keys; drop undefined values entirely.
  const cleaned: InstanceSettings = {};
  if (typeof settings.autoMemory === 'boolean') cleaned.autoMemory = settings.autoMemory;
  if (typeof settings.minMemory === 'number') cleaned.minMemory = settings.minMemory;
  if (typeof settings.maxMemory === 'number') cleaned.maxMemory = settings.maxMemory;
  if (typeof settings.permSize === 'number' && settings.permSize > 0) cleaned.permSize = settings.permSize;
  if (typeof settings.javaArgs === 'string' && settings.javaArgs !== '') {
    cleaned.javaArgs = settings.javaArgs;
  }
  if (settings.gameDirType === 'global' || settings.gameDirType === 'instance') {
    cleaned.gameDirType = settings.gameDirType;
  }
  if (typeof settings.javaExecutable === 'string' && settings.javaExecutable !== '') {
    cleaned.javaExecutable = settings.javaExecutable;
  }
  if (typeof settings.width === 'number' && settings.width > 0) cleaned.width = settings.width;
  if (typeof settings.height === 'number' && settings.height > 0) cleaned.height = settings.height;
  if (settings.fullscreen === true) cleaned.fullscreen = true;
  if (typeof settings.server === 'string' && settings.server.trim() !== '') {
    cleaned.server = settings.server.trim();
  }
  if (typeof settings.gameArguments === 'string' && settings.gameArguments !== '') {
    cleaned.gameArguments = settings.gameArguments;
  }
  if (typeof settings.environmentVariables === 'string' && settings.environmentVariables.trim() !== '') {
    cleaned.environmentVariables = settings.environmentVariables;
  }
  const priority = settings.processPriority;
  if (typeof priority === 'string' &&
      ['high', 'above_normal', 'normal', 'below_normal', 'low'].includes(priority)) {
    cleaned.processPriority = priority;
  }
  if (typeof settings.wrapper === 'string' && settings.wrapper.trim() !== '') {
    cleaned.wrapper = settings.wrapper.trim();
  }
  if (settings.noOptimizingJVMArgs === true) cleaned.noOptimizingJVMArgs = true;
  for (const key of [
    'icon',
    'javaArgs',
    'quickPlayWorld',
    'precallCommand',
    'nativesDirectory'
  ] as const) {
    const value = settings[key];
    if (typeof value === 'string' && value !== '') (cleaned as Record<string, unknown>)[key] = value;
  }
  if (
    settings.windowType === 'windowed' ||
    settings.windowType === 'maximized' ||
    settings.windowType === 'fullscreen'
  ) {
    cleaned.windowType = settings.windowType;
  }
  const quickPlay = settings.quickPlay;
  if (quickPlay === 'none' || quickPlay === 'multiplayer' || quickPlay === 'singleplayer' || quickPlay === 'realms') {
    cleaned.quickPlay = quickPlay;
  }
  const graphics = settings.graphicsBackend;
  if (graphics === 'default' || graphics === 'opengl' || graphics === 'vulkan') {
    cleaned.graphicsBackend = graphics;
  }
  const visibility = settings.launcherVisibility;
  if (
    visibility === 'keep' ||
    visibility === 'hide' ||
    visibility === 'close' ||
    visibility === 'hide_and_reopen'
  ) {
    cleaned.launcherVisibility = visibility;
  }
  for (const booleanKey of [
    'dontCheckJvmValidity',
    'useCustomNatives',
    'notPatchNatives',
    'useNativeGlfwSdl',
    'useNativeOpenAL',
    'dontCheckGameCompleteness',
    'showLogs',
    'enableDebugLogOutput',
    'allowAutoAgent',
    'disableAutoGameOptions',
    'noJvmArgs'
  ] as const) {
    if (settings[booleanKey] === true) cleaned[booleanKey] = true;
  }
  await writeInstanceSettings(repo, id, cleaned);
  return readInstanceSettings(repo, id);
});

// ============ Instance folder & icon management ============

/**
 * The `--gameDir` a launch of this instance would use: the launcher's own
 * game directory, overlaid with whatever the instance settings say.
 */
async function resolveLaunchGameDir(repo: GameRepository, instanceId: string): Promise<string> {
  const settings = await readInstanceSettings(repo, instanceId);
  return settings.gameDirType === 'instance' ? repo.versionRoot(instanceId) : state.settings.gameDir;
}

/**
 * Resolves a folder inside the instance's run directory, which is what HMCL
 * means by `gameInstance.getRunDirectory()`.
 *
 * It cannot be the version root: a non-isolated instance keeps its mods and
 * resource packs in the shared game directory, so hardcoding the version root
 * would list (and delete, and open) a folder the installer never writes to.
 * `resolveGameDir` gets the isolation right but ignores the global game
 * directory setting, so a custom game directory left every instance page
 * pointing at a folder no launch uses.
 */
async function instanceFolderPath(
  repo: GameRepository,
  instanceId: string,
  folder: string
): Promise<string> {
  const gameDir = await resolveLaunchGameDir(repo, instanceId);
  return folder === '' ? gameDir : join(gameDir, folder);
}

handle(
  'instance:list-folder',
  async (instanceId: string, folder: string): Promise<InstanceFolderEntryDto[]> => {
    const repo = state.repository();
    await assertInstanceExists(repo, instanceId);
    const gameDir = await resolveLaunchGameDir(repo, instanceId);
    const entries = await readdir(folder === '' ? gameDir : join(gameDir, folder), {
      withFileTypes: true
    }).catch(() => [] as import('node:fs').Dirent[]);
    // Only resource packs have a per-file on/off state, and only the game reads
    // it: a pack missing from options.txt is never loaded no matter what is in
    // the folder, which is what "装完游戏里没反应" looked like.
    const packs = folder === 'resourcepacks';
    const enabled = packs ? new Set(enabledResourcePacks((await readGameOptions(gameDir)).entries)) : undefined;
    // A pack the game would refuse is worth saying out loud, so the pack format
    // is read out of the file rather than trusted from the download listing.
    const required = packs ? await requiredResourceFormat(repo, instanceId) : undefined;
    const listed = await Promise.all(
      entries.map(async (entry) => {
        const row: InstanceFolderEntryDto = {
          name: entry.name,
          isDirectory: entry.isDirectory(),
          enabled: enabled !== undefined && enabled.has(entry.name)
        };
        if (!packs || entry.isDirectory() || !entry.name.endsWith('.zip')) return row;
        const metadata = await readPackMetadata(join(gameDir, folder, entry.name));
        const note = packCompatibilityNote(metadata, required);
        if (note !== undefined) {
          row.compatible = false;
          row.compatibilityNote = note;
        }
        return row;
      })
    );
    return listed.sort((a, b) =>
      a.isDirectory === b.isDirectory ? a.name.localeCompare(b.name) : (a.isDirectory ? -1 : 1)
    );
  }
);

/**
 * Turns a resource pack on or off for an instance by rewriting the pack lists in
 * its options.txt — the same switch HMCL's resource pack page offers, since a
 * downloaded pack is otherwise inert until the game is told to load it.
 */
handle(
  'instance:set-resource-pack-enabled',
  async (instanceId: string, name: string, enabled: boolean): Promise<void> => {
    const repo = state.repository();
    await assertInstanceExists(repo, instanceId);
    const gameDir = await resolveLaunchGameDir(repo, instanceId);
    const options = await readGameOptions(gameDir);
    const manifests = new Map(
      (await repo.listInstalledVersions()).map((version) => [version.id, version.manifest])
    );
    const gameVersion = rootGameVersion(instanceId, manifests);
    if (setResourcePackEnabled(options.entries, name, enabled, supportsNewOptionsFormat(gameVersion))) {
      await writeGameOptions(gameDir, options);
    }
  }
);

handle('instance:open-folder', async (instanceId: string, folder: string): Promise<void> => {
  const repo = state.repository();
  await assertInstanceExists(repo, instanceId);
  const path = await instanceFolderPath(repo, instanceId, folder);
  await mkdir(path, { recursive: true });
  await shell.openPath(path);
});

handle('instance:delete-file', async (instanceId: string, folder: string, name: string): Promise<void> => {
  const repo = state.repository();
  await assertInstanceExists(repo, instanceId);
  const dir = await instanceFolderPath(repo, instanceId, folder);
  await rm(join(dir, name), { recursive: true, force: true });
});

handle('instance:clear-assets', async (instanceId: string): Promise<void> => {
  const repo = state.repository();
  await assertInstanceExists(repo, instanceId);
  await rm(repo.assetsDir(), { recursive: true, force: true });
  await rm(join(repo.versionRoot(instanceId), 'resources'), { recursive: true, force: true });
});

handle('instance:clear-libraries', async (): Promise<void> => {
  const repo = state.repository();
  await rm(repo.librariesDir(), { recursive: true, force: true });
});

handle('instance:clean', async (instanceId: string): Promise<void> => {
  const repo = state.repository();
  await assertInstanceExists(repo, instanceId);
  const root = repo.versionRoot(instanceId);
  await rm(join(root, 'logs'), { recursive: true, force: true });
  await rm(join(root, 'crash-reports'), { recursive: true, force: true });
});

/** Well-known icon file names searched under the version root. */
const INSTANCE_ICON_NAMES = ['icon.png', 'icon.jpg', 'icon.jpeg', 'icon.gif', 'icon.webp'];

async function instanceIconPath(repo: GameRepository, instanceId: string): Promise<string | undefined> {
  const root = repo.versionRoot(instanceId);
  for (const name of INSTANCE_ICON_NAMES) {
    const path = join(root, name);
    try {
      await readFile(path);
      return path;
    } catch {
      // try next candidate
    }
  }
  return undefined;
}

async function readInstanceIconDataUrl(instanceId: string): Promise<string | undefined> {
  const repo = state.repository();
  await assertInstanceExists(repo, instanceId);
  const path = await instanceIconPath(repo, instanceId);
  if (path === undefined) return undefined;
  const data = await readFile(path);
  const ext = extname(path).replace('.', '');
  const mime = ext === 'svg' ? 'image/svg+xml' : `image/${ext === 'jpg' ? 'jpeg' : ext}`;
  return `data:${mime};base64,${data.toString('base64')}`;
}

handle('instance:icon-read', (instanceId: string) => readInstanceIconDataUrl(instanceId));

handle('instance:icon-pick', async (instanceId: string): Promise<string | undefined> => {
  const repo = state.repository();
  await assertInstanceExists(repo, instanceId);
  const picked = await dialog.showOpenDialog({
    title: '选择实例图标',
    filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] }],
    properties: ['openFile']
  });
  if (picked.canceled || picked.filePaths.length === 0) return undefined;
  const source = picked.filePaths[0]!;
  const ext = extname(source).toLowerCase() || '.png';
  // HMCL's `setIconFile` drops every existing icon file before copying, so a
  // leftover `icon.jpg` cannot keep winning over the new `icon.png`.
  for (const stale of INSTANCE_ICON_NAMES) {
    await rm(join(repo.versionRoot(instanceId), stale), { force: true });
  }
  const iconName = `icon${ext}`;
  await mkdir(repo.versionRoot(instanceId), { recursive: true });
  await cp(source, join(repo.versionRoot(instanceId), iconName));
  // A custom image outranks a picked icon type, so the type has to go — the same
  // reset to DEFAULT that `GameInstanceIconDialog.exploreIcon` does.
  await clearInstanceIconType(repo, instanceId);
  return readInstanceIconDataUrl(instanceId);
});

handle('instance:icon-type-set', async (instanceId: string, iconType: string): Promise<void> => {
  const repo = state.repository();
  await assertInstanceExists(repo, instanceId);
  const current = await readInstanceSettings(repo, instanceId);
  const next = { ...current };
  delete next.icon;
  // An empty id means "derive it", which is HMCL's DEFAULT. Anything else has
  // to name a real icon, or the settings file would carry a dead value.
  if (parseInstanceIconType(iconType) !== undefined) next.icon = iconType;
  await writeInstanceSettings(repo, instanceId, next);
});

/** Drops the picked icon type, leaving the icon to be derived again. */
async function clearInstanceIconType(repo: GameRepository, instanceId: string): Promise<void> {
  const current = await readInstanceSettings(repo, instanceId);
  if (current.icon === undefined) return;
  const next = { ...current };
  delete next.icon;
  await writeInstanceSettings(repo, instanceId, next);
}

handle('instance:icon-clear', async (instanceId: string): Promise<void> => {
  const repo = state.repository();
  await assertInstanceExists(repo, instanceId);
  const path = await instanceIconPath(repo, instanceId);
  if (path !== undefined) {
    await rm(path, { force: true });
  }
  // HMCL's `onDeleteIcon` resets the setting to DEFAULT as well, so clearing
  // the file also gives up a picked icon type.
  await clearInstanceIconType(repo, instanceId);
});

// ============ Window controls ============

handle('window:minimize', () => {
  win?.minimize();
});

handle('window:toggle-maximize', () => {
  if (win === undefined || win === null || win.isDestroyed()) return;
  if (win.isMaximized()) {
    win.unmaximize();
  } else {
    win.maximize();
  }
});

handle('window:close', () => {
  win?.close();
});

/** Picks the newest Java satisfying the version's requirement. */
async function pickJava(resolved: ResolvedVersion | undefined): Promise<string | undefined> {
  const runtimes = await detectJavaRuntimes();
  const required = resolved?.javaVersion?.majorVersion ?? 8;
  return (
    runtimes.find((runtime) => runtime.majorVersion >= required)?.executable ??
    runtimes[runtimes.length - 1]?.executable
  );
}

app.whenReady().then(async () => {
  await state.loadSettings();
  createWindow();
  applyWindowTransparency();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
