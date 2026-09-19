/**
 * @hmcl/shared — types and channel names shared between the Electron main
 * process and the renderer.
 */

/** Progress snapshot mirrored from @hmcl/core. */
export interface DownloadProgressDto {
  completed: number;
  total: number;
  downloadedBytes: number;
  totalBytes: number | undefined;
  currentFile: string | undefined;
  /** Estimated instantaneous download throughput in bytes/second. */
  bytesPerSecond: number;
}

/** A locally installed game version. */
export interface InstalledVersionDto {
  id: string;
  /** Version family for display (e.g. inheritsFrom target or the id). */
  jar: string | undefined;
  type: string | undefined;
}

/** A remote version from the manifest. */
export interface RemoteVersionDto {
  id: string;
  type: string;
  releaseTime: string;
}

/** A detected Java runtime. */
export interface JavaRuntimeDto {
  executable: string;
  majorVersion: number;
  versionString: string;
}

/** Modrinth project types surfaced in the download page. */
export type ModrinthProjectType = 'mod' | 'modpack' | 'resourcepack' | 'shader';

/** Subdirectories an addon file can be installed into inside an instance. */
export type AddonSubdir = 'mods' | 'resourcepacks' | 'shaderpacks';

/** Modrinth search indexes surfaced in the 排序 dropdown. */
export type ModrinthSearchIndex = 'relevance' | 'newest' | 'updated' | 'downloads';

/** A paged slice of Modrinth search hits plus the total match count. */
export interface ModrinthSearchResultDto {
  projects: ModrinthProjectDto[];
  totalHits: number;
}

/** A Modrinth project summary for the download list. */
export interface ModrinthProjectDto {
  slug: string;
  title: string;
  description: string;
  iconUrl: string | undefined;
  author: string;
  downloads: number;
  projectType: ModrinthProjectType;
  gameVersions: string[];
  categories: string[];
  latestVersionNumber: string | undefined;
}

/** A Modrinth category (e.g. 科技/魔法) selectable in the 分类 dropdown. */
export interface ModrinthCategoryDto {
  slug: string;
  name: string;
  iconUrl: string | undefined;
}

/** A downloadable file inside a Modrinth version. */
export interface ModrinthFileDto {
  url: string;
  filename: string;
  size: number | undefined;
  sha1: string | undefined;
  primary: boolean;
}

/** A Modrinth version entry shown in the version chooser. */
export interface ModrinthVersionDto {
  id: string;
  projectId: string;
  versionNumber: string;
  name: string;
  gameVersions: string[];
  loaders: string[];
  files: ModrinthFileDto[];
  /** ISO-8601 publish time; absent when the API omits it. */
  datePublished: string | undefined;
  /** Release channel: 'alpha' | 'beta' | 'release'. */
  versionType: string | undefined;
  /** URL of the version changelog page, when the API provides one. */
  changelogUrl: string | undefined;
  /** Declared dependencies (loader, game, other projects). */
  dependencies: ModrinthDependencyDto[];
}

/** Dependency of a Modrinth version. */
export interface ModrinthDependencyDto {
  projectId: string;
  versionId: string | undefined;
  dependencyType: string;
}

/** Supported mod loader kinds. */
export type LoaderKind = 'fabric' | 'forge' | 'neoforge' | 'optifine';

/** Metadata discovered inside a local `.zip` / `.mrpack` modpack file. */
export interface ModpackInspectDto {
  /** File name without directory prefix, e.g. `owo-modpack.mrpack`. */
  fileName: string;
  /** Pack name from `modrinth.index.json` / `manifest.json`, when present. */
  name: string | undefined;
  version: string | undefined;
  author: string | undefined;
  summary: string | undefined;
}

/** A mod loader build available for one Minecraft version. */
export interface LoaderVersionDto {
  /** Opaque selector passed back to installLoader. */
  id: string;
  kind: LoaderKind;
  /** Human-readable version, e.g. `0.16.14` or `51.0.33`. */
  label: string;
  stable: boolean;
}

/** Launcher settings persisted by the main process. */
export interface SettingsDto {
  playerName: string;
  gameDir: string;
  maxMemory: number | undefined;
  minMemory: number | undefined;
  autoMemory: boolean | undefined;
  javaExecutable: string | undefined;
  javaArgs: string | undefined;
  gameDirType: 'global' | 'instance' | undefined;
  downloadMirror: 'mojang' | 'bmclapi';
  /** Mirror serving Modrinth file downloads (fallback after the CDN). */
  modrinthMirrorRoot: string | undefined;
  /** Currently selected account id. */
  selectedAccountId: string | undefined;
  /** Azure application client id used for Microsoft logins. */
  microsoftClientId: string | undefined;
  /** Accent color for the Material-you theme (e.g. `#4352a5`); undefined = default. */
  themeColor: string | undefined;
  /** Path to a background image copied under userData; undefined/'' = no background. */
  themeBackground: string | undefined;
  /** April Fools easter egg toggle, matching HMCL's Fools setting. */
  aprilFools: boolean | undefined;
  /** Update channel controlling which releases the banner advertises. */
  updateChannel: 'stable' | 'dev' | undefined;
  /** Whether the OS window itself is translucent (HMCL 透明背景; Linux needs a compositor). */
  launcherBackgroundTransparent: boolean | undefined;
  /** The currently selected game instance id; restored on startup. */
  selectedInstanceId: string | undefined;
  /** The most recently launched game instance id; preferred on startup. */
  lastLaunchedId: string | undefined;
  /** Download settings */
  fileDownloadSource: 'mojang' | 'bmclapi' | undefined;
  defaultAddonSource: 'modrinth' | 'curseforge' | undefined;
  commonDirectory: string | undefined;
  commonDirectoryType: 'default' | 'custom' | undefined;
  autoDownloadThreads: boolean | undefined;
  downloadThreads: number | undefined;
  /** Proxy settings */
  useProxy: boolean | undefined;
  proxyHost: string | undefined;
  proxyPort: number | undefined;
  proxyType: 'http' | 'socks5' | undefined;
  proxyAuth: boolean | undefined;
  proxyUsername: string | undefined;
  proxyPassword: string | undefined;
  /** UI language */
  language: string | undefined;
}

/** An account exposed to the renderer (secrets omitted). */
export interface AccountDto {
  id: string;
  kind: 'offline' | 'microsoft';
  username: string;
  /** Profile id (UUID); may be undefined for legacy accounts. */
  uuid: string | undefined;
}

/** Device-code login progress shown to the user. */
export interface MicrosoftDeviceCodeDto {
  userCode: string;
  verificationUri: string;
}

/** Per-instance settings overrides. */
export interface InstanceSettingsDto {
  autoMemory?: boolean;
  minMemory?: number;
  maxMemory?: number;
  javaArgs?: string;
  gameDirType?: 'global' | 'instance';
  javaExecutable?: string;
  width?: number;
  height?: number;
  fullscreen?: boolean;
  server?: string;
  gameArguments?: string;
  environmentVariables?: string;
  processPriority?: 'high' | 'above_normal' | 'normal' | 'below_normal' | 'low';
  wrapper?: string;
  noOptimizingJVMArgs?: boolean;
}

/** Events pushed from main to renderer. */
export type LauncherEvent =
  | { kind: 'stage'; launchId: number; stage: string }
  | { kind: 'download-progress'; launchId: number; progress: DownloadProgressDto }
  | { kind: 'download-settled'; launchId: number; ok: boolean; error?: string }
  | { kind: 'output'; launchId: number; line: string; isError: boolean }
  | { kind: 'exit'; launchId: number; code: number | null }
  | { kind: 'microsoft-device-code'; code: MicrosoftDeviceCodeDto }
  | { kind: 'microsoft-login-result'; ok: boolean; message: string }
  | { kind: 'window-maximized'; maximized: boolean };

/** Typed surface exposed on `window.hmcl` via the preload bridge. */
export interface HmclApi {
  listInstalledVersions(): Promise<InstalledVersionDto[]>;
  fetchRemoteVersions(): Promise<RemoteVersionDto[]>;
  installVersion(id: string): Promise<void>;
  fetchLoaderVersions(kind: LoaderKind, mcVersion: string): Promise<LoaderVersionDto[]>;
  /** @returns the id of the newly created instance */
  installLoader(kind: LoaderKind, mcVersion: string, loaderId: string): Promise<string>;
  /** Searches Modrinth projects (模组/资源包/光影/整合包). */
  searchModrinthProjects(payload: {
    type: ModrinthProjectType;
    query?: string;
    gameVersion?: string;
    categories?: string[];
    index?: ModrinthSearchIndex;
    offset?: number;
    limit?: number;
  }): Promise<ModrinthSearchResultDto>;
  /** Lists the Modrinth categories available for a project type. */
  fetchModrinthCategories(projectType: ModrinthProjectType): Promise<ModrinthCategoryDto[]>;
  /** Lists versions of a Modrinth project (by slug or id). */
  fetchModrinthVersions(projectIdOrSlug: string): Promise<ModrinthVersionDto[]>;
  /** Downloads the primary file of a Modrinth version into an instance folder. */
  downloadAddonFile(
    instanceId: string,
    subdir: AddonSubdir,
    version: ModrinthVersionDto
  ): Promise<void>;
  /** Saves the primary file of a Modrinth version via a save dialog; false when cancelled. */
  saveAddonFile(url: string, filename: string): Promise<boolean>;
  /** Opens a file dialog for a local modpack; resolves undefined when cancelled. */
  pickModpackFile(): Promise<string | undefined>;
  /** Reads the metadata embedded in a local .zip/.mrpack modpack file. */
  inspectModpackFile(path: string): Promise<ModpackInspectDto>;
  /** Installs a local .zip/.mrpack modpack into a new version-isolated instance. */
  installModpackFile(path: string, instanceName: string): Promise<string>;
  /** Downloads a Modrinth modpack version and installs it as a new instance. */
  installModrinthModpack(projectId: string, versionId: string, instanceName: string): Promise<string>;
  detectJava(): Promise<JavaRuntimeDto[]>;
  /** Opens a file dialog to pick a java executable; undefined when cancelled. */
  pickJavaExecutable(): Promise<string | undefined>;
  /** Total physical memory in MiB, used by the memory status bar. */
  getSystemMemory(): Promise<number>;
  getSettings(): Promise<SettingsDto>;
  saveSettings(settings: Partial<SettingsDto>): Promise<SettingsDto>;
  launch(versionId: string): Promise<number>;
  cancelLaunch(launchId: number): Promise<boolean>;
  /** Opens an https URL in the system browser. */
  openExternal(url: string): Promise<void>;
  listAccounts(): Promise<AccountDto[]>;
  /** Adds an offline account; a custom UUID may be supplied for the advanced option. */
  addOfflineAccount(username: string, uuid?: string): Promise<AccountDto>;
  startMicrosoftLogin(): Promise<AccountDto>;
  cancelMicrosoftLogin(): Promise<void>;
  removeAccount(id: string): Promise<void>;
  selectAccount(id: string): Promise<void>;
  deleteInstance(id: string): Promise<void>;
  renameInstance(oldId: string, newId: string): Promise<void>;
  copyInstance(sourceId: string, newId: string): Promise<void>;
  getInstanceSettings(id: string): Promise<InstanceSettingsDto>;
  saveInstanceSettings(id: string, settings: InstanceSettingsDto): Promise<InstanceSettingsDto>;
  /** Opens a file dialog for a background image; resolves to the copied path or undefined. */
  pickThemeBackground(): Promise<string | undefined>;
  /** Reads an image file as a data URL suitable for a CSS background. */
  readThemeBackground(path: string): Promise<string | undefined>;
  /** Makes the OS window translucent (true) or opaque (false). */
  setLauncherBackgroundTransparent(enabled: boolean): Promise<void>;
  /** Reasserts the window background color to work around a stuck opaque layer. */
  fixBackgroundTransparency(): Promise<void>;
  /** Appends the given log text to a timestamped file and reveals it in the file manager. */
  exportLogs(text: string): Promise<string>;
  /** Renames an existing (offline) account. */
  renameAccount(id: string, username: string): Promise<AccountDto>;
  /** Minimizes the launcher window. */
  minimizeWindow(): Promise<void>;
  /** Toggles maximized/restored window state. */
  toggleMaximizeWindow(): Promise<void>;
  /** Closes the launcher window. */
  closeWindow(): Promise<void>;
  onEvent(listener: (event: LauncherEvent) => void): () => void;
}
