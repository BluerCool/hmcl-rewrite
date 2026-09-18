/**
 * Electron main process: owns the @hmcl/core services, persists settings
 * and bridges everything to the renderer over IPC.
 */
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { basename, extname, join } from 'node:path';
import { cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';
import { totalmem } from 'node:os';
import {
  AccountStore,
  BmclapiDownloadProvider,
  Downloader,
  GameRepository,
  Launcher,
  MojangDownloadProvider,
  applyInstanceSettings,
  createOfflineProfile,
  detectJavaRuntimes,
  downloadAddonFile,
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
  optiFineLoaderId,
  parseOptiFineLoaderId,
  primaryFileOf,
  readInstanceSettings,
  searchModrinthProjects,
  writeInstanceSettings,
  type DownloadProvider,
  type InstanceSettings,
  type LaunchOptions,
  type ModrinthCategory,
  type ModrinthFile,
  type ModrinthProject,
  type ModrinthProjectType,
  type ModrinthVersion,
  type ResolvedVersion
} from '@hmcl/core';
import type {
  AccountDto,
  AddonSubdir,
  InstanceSettingsDto,
  LoaderKind,
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
  language: undefined
};

/** Application state held by the main process. */
class AppState {
  settings: SettingsDto = { ...DEFAULT_SETTINGS };
  readonly accounts = new AccountStore(join(app.getPath('userData'), 'accounts.json'));
  readonly runningLaunches = new Map<number, AbortController>();
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

/** Default window paint, matching the light monet surface until the renderer loads. */
const DEFAULT_WINDOW_BACKGROUND = '#fbf8ff';

/** Applies the translucent/opaque window paint according to the stored setting. */
function applyWindowTransparency(): void {
  const transparent = state.settings.launcherBackgroundTransparent === true;
  win?.setBackgroundColor(transparent ? '#00000000' : DEFAULT_WINDOW_BACKGROUND);
}

/** The single launcher window, used by the renderer-facing window controls. */
let win: BrowserWindow | null = null;

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

function broadcast(event: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('hmcl:event', event);
  }
}

type IpcHandler = (...args: never[]) => unknown | Promise<unknown>;

function handle(channel: string, handler: IpcHandler): void {
  ipcMain.handle(channel, (_event, ...args) => handler(...(args as never[])));
}

handle('versions:list', async () => {
  const repo = state.repository();
  const versions = await repo.listInstalledVersions();
  return versions.map((version) => ({
    id: version.id,
    jar: version.manifest.jar ?? version.id,
    type: version.manifest.type
  }));
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
    const onLine = (line: string): void =>
      broadcast({ kind: 'output', launchId, line, isError: false });

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
    broadcast({ kind: 'download-settled', launchId, ok: true });
    return createdId;
  } catch (e) {
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

/** Writes the given launcher log to userData/logs and reveals it in the file manager. */
handle('logs:export', async (text: string) => {
  const dir = join(app.getPath('userData'), 'logs');
  await mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = join(dir, `launcher-${stamp}.log`);
  await writeFile(target, text, 'utf8');
  shell.showItemInFolder(target);
  return target;
});

handle('launch:start', async (versionId: string) => {
  const launchId = state.allocateLaunchId();
  const abort = new AbortController();
  state.runningLaunches.set(launchId, abort);

  const repo = state.repository();
  const resolved: ResolvedVersion = await repo.resolveInstalledVersion(versionId);

  // Resolve credentials from the selected account (falls back to offline).
  let auth;
  const account = state.selectedAccount();
  if (account !== undefined) {
    auth = await state.accounts.getCredentials(account, state.settings.microsoftClientId ?? '');
  } else {
    auth = createOfflineProfile(state.settings.playerName);
  }

  // Effective options: global settings overlaid with per-instance overrides.
  const javaExecutable =
    state.settings.javaExecutable ?? (await pickJava(resolved)) ?? 'java';
  const launcher = new Launcher(repo, state.provider());
  const launchOptions: LaunchOptions = {
    javaExecutable,
    javaMajorVersion: 17,
    gameDir: state.settings.gameDir
  };
  if (state.settings.maxMemory !== undefined) {
    launchOptions.maxMemory = state.settings.maxMemory;
  }
  const effectiveOptions = applyInstanceSettings(
    launchOptions,
    await readInstanceSettings(repo, versionId),
    repo,
    versionId,
    state.settings.maxMemory,
    javaExecutable
  );
  void launcher
    .launch(resolved, auth, effectiveOptions, (event) =>
      broadcast({ kind: event.type, launchId, ...(event as object) })
    )
    .catch((error: unknown) => {
      broadcast({
        kind: 'output',
        launchId,
        line: `Launch failed: ${String(error)}`,
        isError: true
      });
      broadcast({ kind: 'exit', launchId, code: -1 });
    })
    .finally(() => state.runningLaunches.delete(launchId));

  return launchId;
});

handle('launch:cancel', (launchId: number) => {
  const abort = state.runningLaunches.get(launchId);
  if (abort === undefined) return false;
  abort.abort();
  state.runningLaunches.delete(launchId);
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
    await downloadAddonFile(repo, state.provider(), instanceId, subdir, toCoreModrinthVersion(version), (p) =>
      broadcast({ kind: 'download-progress', launchId, progress: p })
    );
    broadcast({ kind: 'download-settled', launchId, ok: true });
  } catch (e) {
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
    return await installModpackFile(state.repository(), state.provider(), String(path), String(instanceName), {
      java: await resolveJava(),
      onProgress: (p) => broadcast({ kind: 'download-progress', launchId, progress: p }),
      onLine: (line) => broadcast({ kind: 'output', launchId, line, isError: false })
    });
    broadcast({ kind: 'download-settled', launchId, ok: true });
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

    try {
      return await installModpackFile(state.repository(), provider, target, String(instanceName), {
        java: await resolveJava(),
        onProgress: (p) => broadcast({ kind: 'download-progress', launchId, progress: p }),
        onLine: (line) => broadcast({ kind: 'output', launchId, line, isError: false })
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
    broadcast({ kind: 'download-settled', launchId, ok: true });
  } catch (e) {
    broadcast({ kind: 'download-settled', launchId, ok: false, error: String(e) });
    throw e;
  }
});

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
  await writeInstanceSettings(repo, id, cleaned);
  return readInstanceSettings(repo, id);
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
