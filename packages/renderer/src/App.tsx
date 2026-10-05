import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AccountDto,
  DownloadProgressDto,
  InstalledVersionDto,
  InstanceFolder,
  InstanceFolderEntryDto,
  InstanceSettingsDto,
  JavaRuntimeDto,
  LauncherEvent,
  LoaderKind,
  LoaderVersionDto,
  MicrosoftDeviceCodeDto,
  ModpackInspectDto,
  ModrinthCategoryDto,
  ModpackVersionChoiceDto,
  ModrinthProjectDto,
  ModrinthProjectType,
  ModrinthSearchIndex,
  ModrinthSearchResultDto,
  ModrinthVersionDto,
  RemoteVersionDto,
  SettingsDto
} from '@hmcl/shared';
import {
  AddIcon,
  ArrowForwardIcon,
  ArrowUpIcon,
  BugIcon,
  CloseIcon,
  CoffeeIcon,
  ContentCopyIcon,
  DeleteForeverIcon,
  DeployedCodeFillIcon,
  DeployedCodeIcon,
  DownloadIcon,
  ExtensionFillIcon,
  ExtensionIcon,
  FolderCopyIcon,
  FolderOpenIcon,
  GameIcon,
  GamepadFillIcon,
  GamepadIcon,
  InfoIcon,
  ListIcon,
  MaximizeIcon,
  MenuIcon,
  MicrosoftIcon,
  MinimizeIcon,
  OutputIcon,
  PackageFillIcon,
  PackageIcon,
  PaletteIcon,
  PersonIcon,
  PlayIcon,
  PublicIcon,
  RefreshIcon,
  RestoreIcon,
  RocketIcon,
  SchemaFillIcon,
  SchemaIcon,
  ScreenshotIcon,
  ScriptIcon,
  SearchIcon,
  SettingsFillIcon,
  SettingsIcon,
  SunnyFillIcon,
  SunnyIcon,
  TerminalIcon,
  TextureIcon,
  UpdateIcon,
  WikiIcon,
  ArrowBackIcon,
  EditIcon,
  HelpIcon,
  MoreVertIcon
} from './icons';
import { offlineUuid } from './md5';
import { hmcl } from './bridge';

export { hmcl };

export interface LogLine {
  text: string;
  isError: boolean;
}

export type PageId = 'home' | 'accounts' | 'instances' | 'download' | 'settings' | 'terracotta';

/// Titles shown in the Decorator navigation bar, mirroring HMCL's page states.
const PAGE_TITLES: Record<PageId, string> = {
  home: '详情',
  accounts: '账户',
  instances: '实例列表',
  download: '下载',
  settings: '设置',
  terracotta: 'Terracotta'
};

/** The launcher's default Material-you accent (matching original blue.css). */
const DEFAULT_THEME_COLOR = '#4352a5';
const HMCL_GITHUB_URL = 'https://github.com/HMCL-dev/HMCL';
const HMCL_RELEASES_URL = 'https://github.com/HMCL-dev/HMCL/releases';
const MODRINTH_URL = 'https://modrinth.com';

/** Version of this rewrite, shown on the About tab. */
const REWRITE_VERSION = '0.1.0';

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 6) return '夜深了';
  if (hour < 12) return '早上好';
  if (hour < 14) return '中午好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

function isAprilFoolsDay(): boolean {
  const d = new Date();
  return d.getMonth() === 3 && d.getDate() === 1;
}

export function useLauncherState() {
  const [settings, setSettings] = useState<SettingsDto | undefined>(undefined);
  const [accounts, setAccounts] = useState<AccountDto[]>([]);
  const [installed, setInstalled] = useState<InstalledVersionDto[]>([]);
  const [javas, setJavas] = useState<JavaRuntimeDto[]>([]);
  const [currentId, setCurrentId] = useState<string | undefined>(undefined);
  const [page, setPage] = useState<PageId>('home');

  const setCurrentIdAndPersist = useCallback(
    (id: string | undefined) => {
      setCurrentId(id);
      if (id !== undefined) {
        void hmcl().saveSettings({ selectedInstanceId: id });
      }
    },
    []
  );

  const [managingId, setManagingId] = useState<string | undefined>(undefined);

  /** Opens the instance management page for `id` and marks it the current one. */
  const openInstance = useCallback(
    (id: string): void => {
      setCurrentIdAndPersist(id);
      setManagingId(id);
    },
    [setCurrentIdAndPersist]
  );
  const [stage, setStage] = useState('空闲');
  const [progress, setProgress] = useState<DownloadProgressDto | undefined>();
  const [downloading, setDownloading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | undefined>(undefined);
  const [deviceCode, setDeviceCode] = useState<MicrosoftDeviceCodeDto | undefined>(undefined);
  const [maximized, setMaximized] = useState(false);
  /** The launch whose game process is up, once the stage event says so. */
  const [runningGameId, setRunningGameId] = useState<number | undefined>(undefined);

  const finishTimer = useRef<number | undefined>(undefined);
  const stageTimer = useRef<number | undefined>(undefined);
  const toastTimer = useRef<number | undefined>(undefined);
  const lastDownloadEvent = useRef<number>(0);

  /**
   * Shows a transient confirmation anywhere in the window. It lives here
   * rather than in the dialog that raises it: a dialog unmounts the moment the
   * user acts on it, so a local toast never got a chance to render.
   */
  const showToast = useCallback((message: string): void => {
    setToast(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(undefined), 2500);
  }, []);
  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  /**
   * Writes the status line. Transient statuses (a finished launch, a failure)
   * schedule their own reset; a real stage event cancels the pending one so a
   * new launch never inherits a stale countdown.
   */
  const setStageText = (text: string): void => {
    window.clearTimeout(stageTimer.current);
    setStage(text);
  };

  /** Shows `text` briefly, then falls back to the idle label. */
  const setTransientStage = (text: string, ms = 4000): void => {
    window.clearTimeout(stageTimer.current);
    setStage(text);
    stageTimer.current = window.setTimeout(() => setStage('空闲'), ms);
  };

  // Keep the latest settings readable from refreshInstalled even before the
  // settings state has propagated to the current render's closure.
  const settingsRef = useRef<SettingsDto | undefined>(undefined);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const refreshInstalled = async (preferredSettings?: SettingsDto): Promise<void> => {
    const versions = await hmcl().listInstalledVersions();
    setInstalled(versions);
    // Stale bootstrapping closures read settings before the state propagates;
    // the caller passes the just-loaded settings on first run.
    const restored =
      (preferredSettings ?? settingsRef.current)?.lastLaunchedId ??
      (preferredSettings ?? settingsRef.current)?.selectedInstanceId;
    setCurrentId((current) => {
      if (restored !== undefined && versions.some((v) => v.id === restored)) {
        return restored;
      }
      return versions.some((version) => version.id === current) ? current : versions[0]?.id;
    });
  };

  const refreshAccounts = async (): Promise<void> => {
    setAccounts(await hmcl().listAccounts());
  };

  /**
   * Hands one launcher-side message to the log window.
   *
   * The buffer lives in main, the way HMCL's `CircularArrayList` lives in the
   * launcher and is shared with every `LogWindow` (LauncherHelper.java:857), so
   * closing and reopening the window never loses the session.
   */
  const appendLog = (line: LogLine): void => {
    void hmcl()
      .appendLog({ text: line.text, isError: line.isError })
      .catch(() => undefined);
  };

  /** Writes the session log to a timestamped file and reports where it went. */
  const exportLogs = async (): Promise<void> => {
    try {
      const target = await hmcl().exportLogs();
      appendLog({ text: `日志已导出: ${target}`, isError: false });
    } catch (error) {
      appendLog({ text: `导出日志失败: ${String(error)}`, isError: true });
    }
  };

  /**
   * Shared failure path for all three launch entry points (home pane, instance
   * list, instance manage). Previously each one only appended to the log
   * drawer, which starts closed, so a failed launch looked like nothing had
   * happened at all. Now the reason is logged, the busy flag is released, the
   * status line says so, and the log window opens to show the detail.
   */
  const reportLaunchFailure = (error: unknown): void => {
    appendLog({ text: String(error), isError: true });
    setBusy(false);
    setTransientStage('启动失败');
    void hmcl().openLogWindow();
  };

  /**
   * Ends the running game. No confirmation: the user is looking at a game they
   * want gone, and the main process already gives it a chance to save first.
   */
  const stopGame = async (): Promise<void> => {
    if (runningGameId === undefined) return;
    const stopped = await hmcl().stopGame(runningGameId);
    if (!stopped) return;
    appendLog({ text: '>>> 请求结束游戏进程', isError: false });
    // The exit event clears busy and runningGameId on its own; the stage line
    // waits for it too, so nothing here should claim the game is already gone.
    setTransientStage('正在结束游戏进程…');
  };

  const subscribeEvents = (): (() => void) =>
    hmcl().onEvent((event: LauncherEvent) => {
      switch (event.kind) {
        case 'stage':
          setStageText(STAGE_LABELS[event.stage] ?? event.stage);
          // 'running' is the only stage with a process behind it, so it is what
          // decides whether 结束游戏 has something to end.
          setRunningGameId(event.stage === 'running' ? event.launchId : undefined);
          break;
        case 'download-progress':
          setProgress(event.progress);
          setDownloading(event.progress.total > 0);
          lastDownloadEvent.current = Date.now();
          // Hide the bar 700ms after the LAST event (not after completion),
          // so batch transitions don't cause flicker. Dropping the progress
          // alongside it keeps a finished download from leaving a stale
          // "N/M files" count on the status line.
          window.clearTimeout(finishTimer.current);
          finishTimer.current = window.setTimeout(() => {
            if (Date.now() - lastDownloadEvent.current >= 700) {
              setDownloading(false);
              setProgress(undefined);
            }
          }, 700);
          break;
        case 'exit':
          setBusy(false);
          setRunningGameId(undefined);
          // The launch pane falls back to 启动游戏 the moment busy clears, so a
          // stage line about the game ending would never be read. A toast is the
          // one notice that survives that.
          if (event.stopped === true) {
            // Ended on request: a killed JVM reports no code, which would
            // otherwise read as a crash the user just caused.
            setTransientStage('已结束游戏进程');
            showToast('已结束游戏进程');
          } else if (event.code === 0) {
            setTransientStage('游戏已退出');
            showToast('游戏已退出');
          } else if (event.code === -1) {
            // The main process maps a failed launch to -1 and puts the reason
            // in the log, so open the log window instead of leaving a bare -1
            // on screen. This is the failure path that actually fires: a launch
            // that blows up never rejects launch:start.
            setTransientStage('启动失败');
            showToast('启动失败');
            void hmcl().openLogWindow();
          } else {
            // The game did start, then exited on its own. Its own output is
            // already in the log, so surface that too (HMCL does the same for
            // a crash) rather than only reporting a code.
            setTransientStage(`游戏已退出，退出码 ${String(event.code)}`);
            showToast(`游戏已退出，退出码 ${String(event.code)}`);
            void hmcl().openLogWindow();
          }
          break;
        case 'microsoft-device-code':
          setDeviceCode(event.code);
          break;
        case 'microsoft-login-result':
          setDeviceCode(undefined);
          if (event.ok) void refreshAccounts();
          break;
        case 'download-settled':
          if (event.ok) {
            // Success: keep the 700ms grace period (same as complete progress)
            window.clearTimeout(finishTimer.current);
            finishTimer.current = window.setTimeout(() => {
              setDownloading(false);
              setProgress(undefined);
            }, 700);
          } else {
            // Failure: stop immediately and show error in log
            setDownloading(false);
            setProgress(undefined);
            appendLog({ text: `下载失败: ${event.error ?? '未知错误'}`, isError: true });
          }
          break;
        case 'window-maximized':
          setMaximized(event.maximized);
          break;
      }
    });

  return {
    settings,
    setSettings,
    accounts,
    setAccounts,
    installed,
    javas,
    setJavas,
    currentId,
    setCurrentId: setCurrentIdAndPersist,
    stage,
    progress,
    downloading,
    busy,
    setBusy,
    toast,
    showToast,
    deviceCode,
    managingId,
    setManagingId,
    openInstance,
    maximized,
    refreshInstalled,
    refreshAccounts,
    appendLog,
    exportLogs,
    reportLaunchFailure,
    runningGameId,
    stopGame,
    subscribeEvents,
    setPage
  };
}

const STAGE_LABELS: Record<string, string> = {
  idle: '空闲',
  preparing: '准备中',
  resolving: '解析版本',
  'downloading-libraries': '下载依赖库',
  'downloading-assets': '下载游戏资源',
  'extracting-natives': '解压本地库',
  'installing-mods': '正在安装模组',
  'installing-resourcepacks': '正在安装资源包',
  'installing-shaderpacks': '正在安装光影',
  'installing-forge': '正在安装 Forge',
  'installing-neoforge': '正在安装 NeoForge',
  'installing-optifine': '正在安装 OptiFine',
  starting: '正在启动',
  running: '游戏运行中',
  exited: '游戏已退出'
};

/**
 * The main window chrome: HMCL-style left sidebar with account/instance
 * categories plus the routed content area.
 */
export function Shell(): React.JSX.Element | null {
  const state = useLauncherState();
  const [page, setPage] = useState<PageId>('home');
  const [downloadDetail, setDownloadDetail] = useState<ModrinthProjectDto | undefined>(undefined);
  // Which download tab is showing. Held up here rather than inside the page so
  // the instance list's 安装新游戏 button can select a tab the way HMCL's
  // DownloadPage#showGameDownloads does (Instances.java:71).
  const [downloadTab, setDownloadTab] = useState<DlTab>('game');
  const [bgUrl, setBgUrl] = useState<string | undefined>(undefined);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);

  // The 模组/资源包/光影 install target, mirroring HMCL's page-local combo
  // (DownloadListPage#selectedInstance). It lives up here because the page
  // stage is keyed by the open project: opening a project's version list — or
  // coming back from it — remounts the download page, and a target held down
  // there would silently revert to the launcher's own instance mid-install.
  // It is also deliberately not the launcher's selection: writing through to
  // setCurrentId rewrote `selectedInstanceId` in the settings and changed what
  // the home page would launch.
  const [pickedAddonTarget, setPickedAddonTarget] = useState<string | undefined>(undefined);
  useEffect(() => {
    setPickedAddonTarget(undefined);
  }, [state.currentId]);
  const addonTarget = pickedAddonTarget ?? state.currentId;

  // Track dragenter/dragleave depth so host children don't flicker the overlay.
  const onDragEnter = (event: React.DragEvent): void => {
    event.preventDefault();
    dragDepth.current += 1;
    setDragging(true);
  };
  const onDragLeave = (): void => {
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  };

  // Bootstrap: load settings + instances + accounts once, then stream launcher events.
  useEffect(() => {
    let disposed = false;
    void (async () => {
      try {
        const loaded = await hmcl().getSettings();
        if (disposed) return;
        state.setSettings(loaded);
        // The Java list is read from the Java 管理 tab, which is not mounted at
        // startup, so it has to be fetched here rather than by that tab.
        state.setJavas(await hmcl().detectJava());
        await Promise.all([state.refreshInstalled(loaded), state.refreshAccounts()]);
      } catch (error) {
        state.appendLog({ text: `初始化失败: ${String(error)}`, isError: true });
      }
    })();
    const logGlobal = (line: string): void => {
      state.appendLog({ text: line, isError: true });
    };
    const onError = (event: ErrorEvent) => logGlobal(`渲染进程错误: ${event.message}`);
    const onRejection = (event: PromiseRejectionEvent) =>
      logGlobal(`未处理的异步错误: ${String(event.reason)}`);
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    const unsubscribe = state.subscribeEvents();
    return () => {
      disposed = true;
      unsubscribe();
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Personalization: map themeColor over the Material-you CSS variables and
  // preload the chosen background as a data URL for the .launcher-bg layer.
  useEffect(() => {
    const root = document.documentElement;
    const setVar = (name: string, value: string | undefined): void => {
      if (value === undefined || value === '') root.style.removeProperty(name);
      else root.style.setProperty(name, value);
    };
    // A stored color overrides the built-in blue; absent means 默认. `themeColorType`
    // only records which option of the 外观 three-way choice is ticked, so it does
    // not gate the value — the 外观 tab clears the color when you pick 默认.
    const accent = state.settings?.themeColor;
    setVar('--monet-primary', accent);
    setVar('--monet-primary-container', accent);
    setVar('--monet-tertiary-fixed-dim', accent);
    const path = state.settings?.themeBackground;
    if (path === undefined || path === '') {
      setBgUrl(undefined);
      root.classList.remove('has-bg');
      return;
    }
    let cancelled = false;
    void hmcl()
      .readThemeBackground(path)
      .then((data) => {
        if (cancelled || data === undefined) return;
        setBgUrl(data);
        root.classList.add('has-bg');
      })
      .catch(() => root.classList.remove('has-bg'));
    return () => {
      cancelled = true;
    };
  }, [state.settings?.themeColor, state.settings?.themeBackground]);

  // Translucent OS window (HMCL 透明背景): mirror the persisted choice to the
  // native window layer and toggle the CSS class that clears the body paint.
  useEffect(() => {
    const root = document.documentElement;
    const transparent = state.settings?.launcherBackgroundTransparent === true;
    root.classList.toggle('transparent-bg', transparent);
    void hmcl()
      .setLauncherBackgroundTransparent(transparent)
      .catch(() => root.classList.remove('transparent-bg'));
  }, [state.settings?.launcherBackgroundTransparent]);

  // Import of dropped .zip/.mrpack files (HMCL drag-and-drop install).
  const onDrop = (event: React.DragEvent): void => {
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    const files = Array.from(event.dataTransfer.files).filter((file) =>
      /\.(zip|mrpack)$/i.test(file.name)
    );
    for (const file of files) {
      const path = (file as File & { path?: string }).path;
      if (path === undefined) continue;
      void (async () => {
        try {
          const instanceName =
            file.name.replace(/\.[^.]+$/, '').replace(/[^0-9A-Za-z._-]+/g, '-') ||
            `导入_${Date.now()}`;
          await hmcl().installModpackFile(path, instanceName);
          state.appendLog({ text: `已导入整合包: ${file.name}`, isError: false });
          await state.refreshInstalled();
        } catch (error) {
          state.appendLog({ text: `导入 ${file.name} 失败: ${String(error)}`, isError: true });
        }
      })();
    }
  };

  // Material ripple keyed to HMCL's button feedback: spawns a shrinking
  // halo on the nearest interactive host when it is pressed.
  const applyRipple = (event: React.PointerEvent): void => {
    const host = (event.target as HTMLElement).closest<HTMLElement>(
      '.nav-item, .text-button, .raised-button, .menu-button, .launch-button, .advanced-list-item, .java-list li, .titlebar-text-button'
    );
    if (host === null || (host as HTMLButtonElement).disabled) return;
    const rect = host.getBoundingClientRect();
    const diameter = Math.max(rect.width, rect.height) * 2;
    const ripple = document.createElement('span');
    ripple.className = 'ripple';
    ripple.style.width = `${diameter}px`;
    ripple.style.height = `${diameter}px`;
    ripple.style.left = `${event.clientX - rect.left - diameter / 2}px`;
    ripple.style.top = `${event.clientY - rect.top - diameter / 2}px`;
    host.appendChild(ripple);
    ripple.addEventListener('animationend', () => ripple.remove(), { once: true });
  };

  if (state.settings === undefined) {
    return <div className="boot-splash">加载中…</div>;
  }

  // Narrowed view of the shared state once settings are loaded.
  const pageProps: StateHook = {
    ...state!,
    settings: state!.settings,
    setSettings: (next) => state!.setSettings(next)
  } as StateHook;

  // Derive the displayed account name from the selected or first account.
  const selectedAccount = state.accounts.find((a) => a.id === state.settings?.selectedAccountId);
  const accountLabel =
    selectedAccount?.username ??
    state.accounts[0]?.username ??
    state.settings.playerName;

  // Shared title-bar navigation (HMCL MainWindowPane): a single top bar carries
  // the optional back arrow, the page title, and the window controls. The home
  // page is the root (no back arrow); every other view is one level deep.
  const isManaging = state.managingId !== undefined;
  const titleText = isManaging
    ? `实例管理 - ${state.managingId}`
    : page === 'home'
      ? 'HMCL'
      : page === 'download' && downloadDetail !== undefined
        ? downloadDetail.title
        : PAGE_TITLES[page];
  const navBack = isManaging
    ? () => state.setManagingId(undefined)
    : page !== 'home'
      ? page === 'download' && downloadDetail !== undefined
        ? () => setDownloadDetail(undefined)
        : () => setPage('home')
      : undefined;

  return (
    <div
      className="root-shell"
      onPointerDown={applyRipple}
      onDragEnter={onDragEnter}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {bgUrl !== undefined && (
        <div
          className="launcher-bg"
          aria-hidden
          style={{ backgroundImage: `url("${bgUrl}")` }}
        />
      )}
      <div className={`titlebar${state.settings.titleBarTransparent === true ? ' transparent' : ''}`}>
        <div className="titlebar-drag">
          {navBack !== undefined && (
            <button
              className="titlebar-back"
              aria-label="返回"
              title="返回"
              onClick={navBack}
            >
              <ArrowBackIcon size={20} />
            </button>
          )}
          <span className="titlebar-title">{titleText}</span>
        </div>
        <div className="titlebar-controls">
          {navBack !== undefined && (
            <button
              className="titlebar-text-button"
              title="日志"
              aria-label="日志"
              onClick={() => void hmcl().openLogWindow()}
            >
              <TerminalIcon size={15} />
              日志
            </button>
          )}
          <button
            className="titlebar-button"
            title="最小化"
            aria-label="最小化"
            onClick={() => void hmcl().minimizeWindow()}
          >
            <MinimizeIcon size={16} />
          </button>
          <button
            className="titlebar-button"
            title={state.maximized ? '还原' : '最大化'}
            aria-label={state.maximized ? '还原' : '最大化'}
            onClick={() => void hmcl().toggleMaximizeWindow()}
          >
            {state.maximized ? <RestoreIcon size={14} /> : <MaximizeIcon size={13} />}
          </button>
          <button
            className="titlebar-button titlebar-close"
            title="关闭"
            aria-label="关闭"
            onClick={() => void hmcl().closeWindow()}
          >
            <CloseIcon size={16} />
          </button>
        </div>
      </div>
<div className="root">
        {state.managingId !== undefined ? (
          <InstanceManagePage state={pageProps} />
        ) : page === 'home' ? (
          <>
            <aside className="sidebar">
              <div className="sidebar-category">账户</div>
              <button className="nav-item account-item" onClick={() => setPage('accounts')}>
                <span className="avatar">
                  <PersonIcon size={18} />
                </span>
                <span className="nav-text">{accountLabel}</span>
              </button>

              <div className="sidebar-category">实例</div>
              <button className="nav-item game-item" onClick={() => setPage('home')}>
                <span className="nav-icon">
                  <GameIcon size={20} />
                </span>
                <span className="nav-text two-line">
                  <span className="primary">{pageProps.currentId ?? '未选择实例'}</span>
                  <span className="secondary">
                    {pageProps.busy ? pageProps.stage : '点击启动游戏'}
                  </span>
                </span>
              </button>
              <NavItem
                icon={<ListIcon size={20} />}
                label="实例列表"
                active={false}
                onClick={() => setPage('instances')}
              />
              <NavItem
                icon={<DownloadIcon size={20} />}
                label="下载"
                active={false}
                onClick={() => setPage('download')}
              />

              <div className="sidebar-category">常规</div>
              <NavItem
                icon={<SettingsIcon size={20} />}
                label="设置"
                active={false}
                onClick={() => setPage('settings')}
              />
              <NavItem
                icon={<TerminalIcon size={20} />}
                label="日志"
                active={false}
                onClick={() => void hmcl().openLogWindow()}
              />

              <div className="sidebar-category">服务</div>
              <NavItem
                icon={<PublicIcon size={18} />}
                label="Terracotta（占位）"
                active={false}
                onClick={() => setPage('terracotta')}
              />
              <NavItem
                icon={<WikiIcon size={18} />}
                label="GitHub·反馈"
                active={false}
                onClick={() => void hmcl().openExternal(HMCL_GITHUB_URL)}
              />
              <NavItem
                icon={<PublicIcon size={18} />}
                label="Modrinth"
                active={false}
                onClick={() => void hmcl().openExternal(MODRINTH_URL)}
              />
            </aside>
            <main className="content">
              <div className="page-stage" key="home">
                <HomePage state={pageProps} />
              </div>
            </main>
          </>
        ) : (
          <div className="decorated-page">
            <main className="content">
              <div className="page-stage" key={page === 'download' && downloadDetail !== undefined ? `download-detail-${downloadDetail.slug}` : page}>
                {page === 'accounts' && <AccountsPage state={pageProps} />}
                {page === 'instances' && (
                  <InstancesPage
                    state={pageProps}
                    onShowDownloads={(tab) => {
                      setDownloadDetail(undefined);
                      setDownloadTab(tab);
                      setPage('download');
                    }}
                  />
                )}
                {page === 'download' && (
                  <DownloadPage
                    state={pageProps}
                    detail={downloadDetail}
                    tab={downloadTab}
                    onTabChange={setDownloadTab}
                    addonTarget={addonTarget}
                    onAddonTargetChange={setPickedAddonTarget}
                    onOpenDetail={setDownloadDetail}
                    onCloseDetail={() => setDownloadDetail(undefined)}
                  />
                )}
                {page === 'settings' && <SettingsPage state={pageProps} />}
                {page === 'terracotta' && <TerracottaPage />}
              </div>
            </main>
          </div>
        )}
      </div>
      {dragging && (
        <div className="drag-overlay">
          <div className="drag-overlay-inner">
            <DownloadIcon size={40} />
            <span>松开以导入整合包（.zip / .mrpack）</span>
          </div>
        </div>
      )}
      {/* Download progress always deserves a footer. A launch also earns one on
          every page except home, which already surfaces the stage on the launch
          button, the status line and the sidebar — and whose launch pane is
          pinned to the bottom-right, so a footer there would shift the button
          out from under the cursor that just clicked it. */}
      {(state.downloading || (state.busy && page !== 'home')) && (
        <LaunchFooter
          stage={state.stage}
          progress={state.downloading ? state.progress : undefined}
        />
      )}
      {/* The log drawer sits above every page, not inside one of them. It used
          to live in the non-home branch, which meant the title bar's 日志 button
          did nothing on the home and instance-manage pages -- and a failed
          launch, whose only feedback is this drawer, stayed invisible exactly
          where launches are started. */}
      {/* Toasts render here too, above every page and dialog. Raising one from a
          dialog used to render it inside that dialog, so the note vanished the
          instant the user clicked the button that produced it. */}
      {state.toast !== undefined && <div className="toast">{state.toast}</div>}
    </div>
  );
}

function NavItem(props: {
  icon: React.JSX.Element;
  label: string;
  active: boolean;
  onClick: () => void;
}): React.JSX.Element {
  return (
    <button
      className={`nav-item${props.active ? ' active' : ''}`}
      onClick={props.onClick}
    >
      <span className="nav-icon">{props.icon}</span>
      <span className="nav-text">{props.label}</span>
    </button>
  );
}

const PURCHASE_URL = 'https://www.microsoft.com/games/minecraft-java-bundle';
const PROFILE_URL = 'https://account.live.com/editprof.aspx';

const USERNAME_CHECKER_PATTERN = /^[A-Za-z0-9_]+$/;

const NAME_INVALID_HINT =
  '游戏用户名建议仅使用英文字母、数字及下划线，且长度不超过 16 个字符。\n' +
  '\n' +
  '  · 一些合法用户名：HuangYu、huang_Yu、Huang_Yu_123；\n' +
  '  · 一些非法用户名：黄鱼、Huang Yu、Huang-Yu_%%%、Huang_Yu_hello_world_hello_world。\n' +
  '\n' +
  '使用非法用户名会导致你无法加入大部分服务器，并可能与部分模组冲突而使游戏崩溃。';
const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function AccountsPage({ state }: StateHookProps): React.JSX.Element {
  const [sheet, setSheet] = useState<'offline' | 'microsoft' | undefined>(undefined);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | undefined>(undefined);

  const select = async (id: string): Promise<void> => {
    await hmcl().selectAccount(id);
    const updated = await hmcl().getSettings();
    state.setSettings(updated);
  };

  const remove = async (id: string): Promise<void> => {
    await hmcl().removeAccount(id);
    await state.refreshAccounts();
    const updated = await hmcl().getSettings();
    state.setSettings(updated);
  };

  const rename = async (id: string): Promise<void> => {
    const account = state.accounts.find((a) => a.id === id);
    const next = window.prompt('输入新的离线账户名称', account?.username ?? '');
    if (next === null || next.trim() === '') return;
    try {
      await hmcl().renameAccount(id, next.trim());
      await state.refreshAccounts();
      const updated = await hmcl().getSettings();
      state.setSettings(updated);
    } catch (error) {
      state.appendLog({ text: `重命名失败: ${String(error)}`, isError: true });
    }
  };

  const copyUuid = async (id: string): Promise<void> => {
    const account = state.accounts.find((a) => a.id === id);
    if (account?.uuid) await navigator.clipboard.writeText(account.uuid);
  };

  return (
    <div className="accounts-page">
      <aside className="dl-sidebar">
        <div className="class-title">添加账户</div>
        <button
          className="advanced-list-item"
          onClick={() => setSheet('microsoft')}
        >
          <MicrosoftIcon size={20} />
          微软账户
        </button>
        <button
          className="advanced-list-item"
          onClick={() => setSheet('offline')}
        >
          <PersonIcon size={20} />
          离线模式
        </button>
      </aside>

      <div className="dl-main">
        <h2 className="page-title" style={{ padding: '0 10px 10px' }}>
          账户列表
        </h2>
        <div className="account-list">
          {state.accounts.map((account) => (
            <div
              key={account.id}
              className={`account-card-global${account.id === state.settings.selectedAccountId ? ' selected' : ''}`}
              onClick={() => void select(account.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ id: account.id, x: e.clientX, y: e.clientY });
              }}
            >
              <input
                type="radio"
                className="account-radio"
                checked={account.id === state.settings.selectedAccountId}
                onChange={() => void select(account.id)}
              />
              <span className="account-avatar">
                <PersonIcon size={20} />
              </span>
              <div className="two-line">
                <div className="title">{account.username}</div>
                <div className="subtitle">
                  {account.kind === 'offline' ? '离线模式' : '微软账户'}
                </div>
              </div>
              <div className="account-icon-actions">
                <button
                  className="icon-button"
                  title="复制该账户的 UUID"
                  onClick={(e) => { e.stopPropagation(); void copyUuid(account.id); }}
                >
                  <ContentCopyIcon size={20} />
                </button>
                <button
                  className="icon-button"
                  title="删除"
                  onClick={(e) => { e.stopPropagation(); void remove(account.id); }}
                >
                  <DeleteForeverIcon size={20} />
                </button>
              </div>
            </div>
          ))}
          {state.accounts.length === 0 && (
            <div className="empty-hint">尚未添加任何账户。</div>
          )}
        </div>
      </div>

      {menu !== undefined && (
        <div
          className="ctx-menu"
          style={{ left: Math.min(menu.x, window.innerWidth - 180), top: menu.y }}
        >
          <button onClick={() => { setMenu(undefined); void select(menu.id); }}>
            设为当前账户
          </button>
          <button onClick={() => { setMenu(undefined); void rename(menu.id); }}>重命名</button>
          <button className="danger" onClick={() => { setMenu(undefined); void remove(menu.id); }}>
            删除
          </button>
        </div>
      )}

      {sheet !== undefined && (
        <CreateAccountSheet
          kind={sheet}
          deviceCode={state.deviceCode}
          onClose={() => {
            setSheet(undefined);
            if (sheet === 'microsoft') void hmcl().cancelMicrosoftLogin();
          }}
          onAdded={() => {
            void state.refreshAccounts();
            void hmcl().getSettings().then(state.setSettings);
          }}
        />
      )}
    </div>
  );
}

function CreateAccountSheet({
  kind,
  deviceCode,
  onClose,
  onAdded
}: {
  kind: 'offline' | 'microsoft';
  deviceCode: MicrosoftDeviceCodeDto | undefined;
  onClose: () => void;
  onAdded: () => void;
}): React.JSX.Element {
  const [username, setUsername] = useState('');
  const [uuid, setUuid] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const [error, setError] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);

  const usernameValid = USERNAME_CHECKER_PATTERN.test(username) && username.length <= 16;
  const uuidValid = uuid.length === 0 || UUID_PATTERN.test(uuid);
  const formValid = kind === 'microsoft' || (username.length > 0 && uuidValid);

  const login = async (): Promise<void> => {
    setError('');
    if (kind === 'offline' && !usernameValid) {
      setError(NAME_INVALID_HINT);
      return;
    }
    setLoggingIn(true);
    try {
      if (kind === 'offline') {
        await hmcl().addOfflineAccount(username, uuid.length > 0 ? uuid : undefined);
        onAdded();
        onClose();
      } else {
        await hmcl().startMicrosoftLogin();
        onAdded();
        onClose();
      }
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setLoggingIn(false);
    }
  };

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-heading">
          {kind === 'offline' ? '添加离线模式账户' : '添加微软账户'}
        </div>

        {kind === 'microsoft' && (
          <MicrosoftLoginBody
            deviceCode={deviceCode}
            error={error}
            loggingIn={loggingIn}
            onLogin={() => void login()}
          />
        )}
        {kind === 'offline' && (
          <OfflineLoginBody
            username={username}
            uuid={uuid}
            advanced={advanced}
            error={error}
            loggingIn={loggingIn}
            onUsername={(value) => { setUsername(value); setError(''); }}
            onUuid={(value) => { setUuid(value); setError(''); }}
            onToggleAdvanced={() => setAdvanced((v) => !v)}
          />
        )}

        <div className="sheet-actions">
          <button className="dialog-cancel" onClick={onClose}>
            取消
          </button>
          <button
            className="dialog-accept"
            disabled={loggingIn || !formValid}
            onClick={() => void login()}
          >
            {loggingIn ? '登录中…' : '登录'}
          </button>
        </div>
      </div>
    </div>
  );
}

function OfflineLoginBody({
  username,
  uuid,
  advanced,
  error,
  loggingIn,
  onUsername,
  onUuid,
  onToggleAdvanced
}: {
  username: string;
  uuid: string;
  advanced: boolean;
  error: string;
  loggingIn: boolean;
  onUsername: (value: string) => void;
  onUuid: (value: string) => void;
  onToggleAdvanced: () => void;
}): React.JSX.Element {
  const derived = offlineUuid(username);
  return (
    <div className="account-form">
      <div className="form-row">
        <label className="form-label">用户名</label>
        <input
          className="form-input"
          value={username}
          placeholder="建议使用英文字符、数字以及下划线命名，且长度不超过 16 个字符"
          onChange={(e) => onUsername(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !loggingIn) onToggleAdvanced(); }}
        />
      </div>

      <div className="form-row">
        <label className="form-label"> </label>
        <button className="hyperlink" onClick={() => void hmcl().openExternal(PURCHASE_URL)}>
          购买 Minecraft
        </button>
      </div>

      <div className="form-row">
        <label className="form-label"> </label>
        <button className={`menu-up-down-button${advanced ? ' expanded' : ''}`} onClick={onToggleAdvanced}>
          高级
        </button>
      </div>

      {advanced && (
        <>
          <div className="form-row">
            <label className="form-label">UUID</label>
            <input
              className="form-input"
              value={uuid}
              placeholder={derived}
              onChange={(e) => onUuid(e.target.value)}
            />
          </div>
          <div className="hint warning">
            UUID 是 Minecraft 玩家的唯一标识符。每个启动器生成 UUID 的方式可能不同。通过将 UUID 修改为
            原启动器所生成的 UUID，你可以保证在切换启动器后，游戏还能将你的游戏角色识别为给定 UUID
            所对应的角色，从而保留原角色的背包物品。UUID 选项为高级选项。除非你知道你在做什么，否则你不需要调整该选项。
          </div>
        </>
      )}

      {error !== '' && <div className="dialog-error">{error}</div>}
    </div>
  );
}

function MicrosoftLoginBody({
  deviceCode,
  error,
  loggingIn,
  onLogin
}: {
  deviceCode: MicrosoftDeviceCodeDto | undefined;
  error: string;
  loggingIn: boolean;
  onLogin: () => void;
}): React.JSX.Element {
  if (deviceCode !== undefined) {
    const scanUri = `https://www.microsoft.com/link?otc=${deviceCode.userCode}`;
    return (
      <div className="account-form">
        <div className="hint info">
          扫描二维码或访问{' '}
          <button className="hyperlink" onClick={() => void hmcl().openExternal(deviceCode.verificationUri)}>
            {deviceCode.verificationUri}
          </button>
          ，在打开的页面中输入 <b>{deviceCode.userCode}</b> 完成登录。
        </div>
        <div className="code-box" title="点击复制">
          <span className="code-label" onClick={() => void navigator.clipboard.writeText(deviceCode.userCode)}>
            {deviceCode.userCode}
          </span>
        </div>
        <div className="hint info">
          已完成微软账户授权。其余登录步骤将由启动器自动执行，请稍候。
        </div>
      </div>
    );
  }

  return (
    <div className="account-form">
      <div className="hint info">点击“登录”按钮开始添加微软账户。</div>
      <div className="link-row">
        <button className="hyperlink" onClick={onLogin}>
          扫描二维码登录
        </button>
        <button className="hyperlink" onClick={() => void hmcl().openExternal(PROFILE_URL)}>
          编辑账户个人信息
        </button>
        <button className="hyperlink" onClick={() => void hmcl().openExternal(PURCHASE_URL)}>
          购买 Minecraft
        </button>
      </div>
      {error !== '' && <div className="dialog-error">{error}</div>}
    </div>
  );
}

interface StateHook {
  settings: SettingsDto;
  setSettings: (settings: SettingsDto) => void;
  accounts: AccountDto[];
  setAccounts: (accounts: AccountDto[]) => void;
  installed: InstalledVersionDto[];
  javas: JavaRuntimeDto[];
  setJavas: (javas: JavaRuntimeDto[]) => void;
  currentId: string | undefined;
  setCurrentId: (id: string | undefined) => void;
  stage: string;
  progress: DownloadProgressDto | undefined;
  downloading: boolean;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  toast: string | undefined;
  showToast: (message: string) => void;
  deviceCode: MicrosoftDeviceCodeDto | undefined;
  managingId: string | undefined;
  setManagingId: (id: string | undefined) => void;
  openInstance: (id: string) => void;
  maximized: boolean;
  refreshInstalled: (preferredSettings?: SettingsDto) => Promise<void>;
  refreshAccounts: () => Promise<void>;
  /** Hands one launcher-side message to the log window. */
  appendLog: (line: LogLine) => void;
  /** Writes the session log to a timestamped file under the work directory. */
  exportLogs: () => Promise<void>;
  reportLaunchFailure: (error: unknown) => void;
  /** Launch id of the game process currently up, undefined when none is. */
  runningGameId: number | undefined;
  stopGame: () => Promise<void>;
  setPage: (page: PageId) => void;
}

/** Home page: greeting + launch pane pinned bottom-right, HMCL style. */
function HomePage({ state }: StateHookProps): React.JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);
  const current = state.installed.find((version) => version.id === state.currentId);

  const launch = async (): Promise<void> => {
    if (state.currentId === undefined || state.busy) return;
    state.setBusy(true);
    state.appendLog({ text: `>>> 启动 ${state.currentId}`, isError: false });
    try {
      await hmcl().launch(state.currentId);
    } catch (error) {
      state.reportLaunchFailure(error);
    }
  };

  return (
    <div className="page home-page">
      <h2 className="greeting">
        {isAprilFoolsDay() ? '愚人节快乐！' : `${greeting()}，${state.settings.playerName}`}
      </h2>

      <div className="card announcement">
        <div className="card-title">欢迎使用 HMCL Rewrite</div>
        <p>
          这是 Hello Minecraft! Launcher 的 TypeScript 重写版。当前支持：版本管理、
          游戏文件自动补全（客户端 / 库 / 资源）、离线账户与一键启动。
        </p>
      </div>

      <div className="home-status">
        {state.stage}
        {state.downloading && state.progress !== undefined && state.progress.total > 0
          ? ` · ${state.progress.completed}/${state.progress.total} 文件`
          : ''}
      </div>

      <div className="launch-pane">
        {/* Only while a game is actually up: during the download stages there
            is nothing to end, and a button that does nothing is worse than
            none. Sits to the left of the launch button, which then squares off
            its left corners. */}
        {state.runningGameId !== undefined && (
          <button
            className="stop-game-button"
            title="结束游戏进程"
            aria-label="结束游戏进程"
            onClick={() => void state.stopGame()}
          >
            <CloseIcon size={20} />
          </button>
        )}
        {menuOpen && (
          <ul className="version-popup">
            {state.installed.map((version) => (
              <li key={version.id}>
                <button
                  className={version.id === state.currentId ? 'selected' : ''}
                  onClick={() => {
                    state.setCurrentId(version.id);
                    setMenuOpen(false);
                  }}
                >
                  {version.id}
                </button>
              </li>
            ))}
            {state.installed.length === 0 && <li className="empty">暂无实例，前往「下载」安装</li>}
          </ul>
        )}
        <button
          className={`launch-button${state.busy ? ' busy' : ''}`}
          disabled={state.busy || state.currentId === undefined}
          onClick={() => void launch()}
        >
          <PlayIcon size={22} />
          <span className="launch-text">
            <span className="primary">{state.busy ? state.stage : '启动游戏'}</span>
            {current !== undefined && <span className="secondary">{current.id}</span>}
          </span>
        </button>
        <button
          className="menu-button"
          title="切换实例"
          onClick={() => setMenuOpen((open) => !open)}
        >
          <ArrowUpIcon size={26} />
        </button>
      </div>
    </div>
  );
}

/**
 * The instance list's second line, built the way HMCL's `GameItem#init` builds
 * the subtitle (`GameItem.java:106-118`): the game version, then every loader
 * the instance runs as `Label` or `Label: version`.
 *
 * The `: version` half is dropped when the version manifest names no library
 * carrying the loader's version, which is what HMCL does for the same reason
 * (a NeoForge version json lists only `net.neoforged:*` support libraries).
 */
function instanceSubtitle(version: InstalledVersionDto): string {
  const parts = [version.gameVersion];
  for (const loader of version.loaders) {
    parts.push(loader.version === undefined ? loader.label : `${loader.label}: ${loader.version}`);
  }
  return parts.join(', ');
}

/**
 * Whether one instance id survives the list's search text, following HMCL's
 * `GameListPage#createPredicate` (:172-188): a case-insensitive substring match,
 * or a case-insensitive regex when the text starts with `regex:`. A regex that
 * does not compile matches nothing, which is where Java catches
 * PatternSyntaxException and returns a predicate that is always false.
 */
function matchesInstanceSearch(id: string, text: string): boolean {
  if (text === '') return true;
  if (text.startsWith('regex:')) {
    try {
      return new RegExp(text.slice('regex:'.length), 'i').test(id);
    } catch {
      return false;
    }
  }
  return id.toLowerCase().includes(text.toLowerCase());
}

/**
 * Custom instance icons, keyed by instance id.
 *
 * An `icon.<ext>` file has to be read from disk and turned into a data URL, and
 * the list draws every instance at once, so the answers live here rather than in
 * each card's state. `null` remembers an instance that has no such file, which
 * is the common case and must not be asked for twice.
 */
const customIconCache = new Map<string, string | null>();

/** Forgets an instance's cached icon after the icon was changed. */
function forgetInstanceIcon(instanceId: string): void {
  customIconCache.delete(instanceId);
}

function useCustomInstanceIcon(instanceId: string, wanted: boolean): string | undefined {
  const [data, setData] = useState<string | undefined>(() =>
    wanted ? (customIconCache.get(instanceId) ?? undefined) : undefined
  );
  useEffect(() => {
    if (!wanted) {
      setData(undefined);
      return;
    }
    const cached = customIconCache.get(instanceId);
    if (cached !== undefined) {
      setData(cached ?? undefined);
      return;
    }
    let live = true;
    void hmcl().readInstanceIcon(instanceId).then((url) => {
      customIconCache.set(instanceId, url ?? null);
      if (live) setData(url);
    });
    return () => {
      live = false;
    };
  }, [instanceId, wanted]);
  return data;
}

/**
 * The 32px icon on an instance card.
 *
 * HMCL binds it to `gameInstance.getIconImage()`, and that resolution — a picked
 * icon, then a custom image file, then the mod loader, then OptiFine, then the
 * shape of the game version — already happened in the main process. Only a
 * custom file still has to be read here: the list cannot inline a data URL into
 * every entry, so the card asks for one when `customIcon` says there is a file.
 */
function InstanceIconCell({ version }: { version: InstalledVersionDto }): React.JSX.Element {
  const custom = useCustomInstanceIcon(version.id, version.customIcon);
  return (
    <span className="instance-icon">
      <img className="instance-icon-image" src={custom ?? instanceIconAsset(version.icon)} alt="" />
    </span>
  );
}

function InstancesPage({
  state,
  onShowDownloads
}: StateHookProps & { onShowDownloads: (tab: DlTab) => void }): React.JSX.Element {
  /** Pending destructive delete; the instance is only removed once confirmed. */
  const [deleteTarget, setDeleteTarget] = useState<string | undefined>(undefined);
  const [renameTarget, setRenameTarget] = useState<string | undefined>(undefined);
  const [renameValue, setRenameValue] = useState('');
  /**
   * Search bar state. HMCL swaps the whole toolbar for the field and back
   * (GameListPage:243-250), so the two modes are exclusive here too.
   */
  const [searching, setSearching] = useState(false);
  const [searchText, setSearchText] = useState('');
  /**
   * The text the list is actually filtered by. HMCL waits out a 100ms
   * PauseTransition before re-running the predicate (GameListPage:231-236), so
   * that re-filtering 2000 instances does not run on every keystroke.
   */
  const [filter, setFilter] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const [refreshing, setRefreshing] = useState(false);
  /** Local modpack chosen from the toolbar, opened in the install wizard. */
  const [modpackPath, setModpackPath] = useState<string | undefined>(undefined);
  /** Instance whose modpack is being exported, `undefined` when the page is shut. */
  const [exportTarget, setExportTarget] = useState<string | undefined>(undefined);
  const [updateFor, setUpdateFor] = useState<string | undefined>(undefined);

  useEffect(() => {
    const timer = setTimeout(() => setFilter(searchText), 100);
    return () => clearTimeout(timer);
  }, [searchText]);

  useEffect(() => {
    if (searching) searchRef.current?.focus();
  }, [searching]);

  /** Leaves search mode the way HMCL's close button does: clear and unfilter. */
  const closeSearch = (): void => {
    setSearching(false);
    setSearchText('');
    setFilter('');
  };

  const visible = useMemo(
    () => state.installed.filter((version) => matchesInstanceSearch(version.id, filter)),
    [state.installed, filter]
  );

  const refreshList = async (): Promise<void> => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await state.refreshInstalled();
    } finally {
      setRefreshing(false);
    }
  };

  const importModpack = async (): Promise<void> => {
    try {
      const picked = await hmcl().pickModpackFile();
      if (picked !== undefined) setModpackPath(picked);
    } catch (error) {
      state.appendLog({ text: String(error), isError: true });
    }
  };

  /** Permanently removes the instance directory, once confirmed. */
  const deleteInstance = async (): Promise<void> => {
    if (deleteTarget === undefined) return;
    const id = deleteTarget;
    setDeleteTarget(undefined);
    try {
      await hmcl().deleteInstance(id);
      await state.refreshInstalled();
    } catch (error) {
      state.appendLog({ text: `删除失败: ${String(error)}`, isError: true });
    }
  };

  const renameInstance = async (): Promise<void> => {
    if (!renameTarget || renameValue === '') return;
    try {
      await hmcl().renameInstance(renameTarget, renameValue);
      setRenameTarget(undefined);
      setRenameValue('');
      await state.refreshInstalled();
    } catch (e) {
      state.appendLog({ text: `重命名失败: ${String(e)}`, isError: true });
    }
  };

  const copyInstance = async (id: string): Promise<void> => {
    const newId = `${id}_copy`;
    try {
      await hmcl().copyInstance(id, newId);
      await state.refreshInstalled();
    } catch (e) {
      state.appendLog({ text: `复制失败: ${String(e)}`, isError: true });
    }
  };

  const openSettings = (id: string): void => {
    state.openInstance(id);
  };

  const [menuFor, setMenuFor] = useState<string | undefined>(undefined);

  const launchTest = async (id: string): Promise<void> => {
    if (state.busy) return;
    state.setBusy(true);
    state.appendLog({ text: `>>> 测试游戏 ${id}`, isError: false });
    try {
      await hmcl().launch(id);
    } catch (e) {
      state.reportLaunchFailure(e);
    }
  };

  /** Writes the launch script, then reports where it landed. */
  const saveLaunchScript = async (id: string): Promise<void> => {
    try {
      const saved = await hmcl().saveLaunchScript(id);
      if (saved !== undefined) {
        state.appendLog({ text: `启动脚本已生成完毕：${saved}`, isError: false });
      }
    } catch (e) {
      state.appendLog({ text: `生成启动脚本失败: ${String(e)}`, isError: true });
    }
  };

  /**
   * Opens the folder the game would run in, which is what HMCL's
   * `Instances.openFolder` does. For a non-isolated instance that is the shared
   * game directory, not its own version folder.
   */
  const openRunFolder = async (id: string): Promise<void> => {
    try {
      await hmcl().openInstanceFolder(id, '');
    } catch (e) {
      state.appendLog({ text: `打开实例运行文件夹失败: ${String(e)}`, isError: true });
    }
  };

  return (
    <div className="page list-page">
      <h2 className="page-title">实例列表</h2>
      <div className="instance-list-toolbar">
        {searching ? (
          <>
            <div className="search-field instance-list-search">
              <input
                ref={searchRef}
                value={searchText}
                placeholder="搜索"
                aria-label="搜索实例"
                onChange={(e) => setSearchText(e.target.value)}
                // HMCL closes the bar on ESC from the field (GameListPage:242).
                onKeyDown={(e) => {
                  if (e.key === 'Escape') closeSearch();
                }}
              />
            </div>
            <button
              className="icon-button"
              title="关闭搜索"
              aria-label="关闭搜索"
              onClick={closeSearch}
            >
              <CloseIcon size={17} />
            </button>
          </>
        ) : (
          <>
            <button className="text-button" onClick={() => void refreshList()}>
              <RefreshIcon size={15} /> 刷新
            </button>
            <button className="text-button" onClick={() => onShowDownloads('game')}>
              <DownloadIcon size={15} /> 安装新游戏
            </button>
            <button className="text-button" onClick={() => void importModpack()}>
              <PackageIcon size={15} /> 安装整合包
            </button>
            <button className="text-button" onClick={() => setSearching(true)}>
              <SearchIcon size={15} /> 搜索
            </button>
          </>
        )}
      </div>
      {menuFor !== undefined && (
        <button className="menu-backdrop" aria-label="关闭菜单" onClick={() => setMenuFor(undefined)} />
      )}
      {searching && visible.length === 0 && (
        // HMCL binds this label to isSearching and shows it as the list's
        // placeholder, so it is only visible while the filtered list is empty.
        <div className="notice-pane">搜索无结果</div>
      )}
      <ul className="instance-list">
        {visible.map((version) => (
          <li
            key={version.id}
            className={`card instance-card${version.id === state.currentId ? ' selected' : ''}`}
            onClick={() => openSettings(version.id)}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenuFor(version.id);
            }}
          >
            <button
              className="instance-radio"
              title="选择实例"
              aria-label={`选择 ${version.id}`}
              onClick={(e) => {
                e.stopPropagation();
                state.setCurrentId(version.id);
              }}
            >
              {version.id === state.currentId && <span />}
            </button>
            <InstanceIconCell version={version} />
            <div className="instance-info">
              <div className="primary">
                <span className="instance-id">{version.id}</span>
                {/* HMCL's GameItem puts the modpack version in a tag beside the
                    id (GameItem.java:102-108, GameListCell.java:95-101). */}
                {version.modpack !== undefined && (
                  <span className="tag">{version.modpack.version}</span>
                )}
              </div>
              <div className="secondary">{instanceSubtitle(version)}</div>
            </div>
            <div className="instance-actions">
              {/* HMCL shows this for every modpack (GameListCell.java:184-186,
                  canUpdate = isModpack). It can only be offered where the origin
                  project is known, i.e. packs this launcher downloaded. */}
              {version.modpack?.projectId !== undefined && (
                <button
                  className="icon-button"
                  title="更新整合包"
                  aria-label="更新整合包"
                  disabled={state.busy}
                  onClick={(e) => { e.stopPropagation(); setUpdateFor(version.id); }}
                >
                  <UpdateIcon size={19} />
                </button>
              )}
              <button
                className="icon-button"
                title="测试游戏"
                aria-label="测试游戏"
                disabled={state.busy}
                onClick={(e) => { e.stopPropagation(); void launchTest(version.id); }}
              >
                <RocketIcon size={19} />
              </button>
              <button
                className="icon-button"
                title="管理"
                aria-label="管理"
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuFor((current) => (current === version.id ? undefined : version.id));
                }}
              >
                <MoreVertIcon size={19} />
              </button>
              {menuFor === version.id && (
                <ul className="instance-menu" onClick={(e) => e.stopPropagation()}>
                  <li>
                    <button
                      onClick={() => { setMenuFor(undefined); void launchTest(version.id); }}
                    >
                      <RocketIcon size={17} />
                      测试游戏
                    </button>
                  </li>
                  <li>
                    <button
                      onClick={() => { setMenuFor(undefined); void saveLaunchScript(version.id); }}
                    >
                      <ScriptIcon size={17} />
                      生成启动脚本
                    </button>
                  </li>
                  <li className="separator" />
                  <li>
                    <button onClick={() => { setMenuFor(undefined); openSettings(version.id); }}>
                      <SettingsIcon size={17} />
                      实例管理
                    </button>
                  </li>
                  <li className="separator" />
                  <li>
                    <button
                      onClick={() => {
                        setMenuFor(undefined);
                        setRenameTarget(version.id);
                        setRenameValue(version.id);
                      }}
                    >
                      <EditIcon size={17} />
                      重命名该实例
                    </button>
                  </li>
                  <li>
                    <button
                      onClick={() => { setMenuFor(undefined); void copyInstance(version.id); }}
                    >
                      <ContentCopyIcon size={17} />
                      复制游戏实例
                    </button>
                  </li>
                  <li>
                    <button
                      className="delete"
                      onClick={() => { setMenuFor(undefined); setDeleteTarget(version.id); }}
                    >
                      <DeleteForeverIcon size={17} />
                      删除该实例
                    </button>
                  </li>
                  <li>
                    <button onClick={() => { setMenuFor(undefined); setExportTarget(version.id); }}>
                      <PackageIcon size={17} />
                      导出整合包
                    </button>
                  </li>
                  <li className="separator" />
                  <li>
                    <button onClick={() => { setMenuFor(undefined); void openRunFolder(version.id); }}>
                      <FolderOpenIcon size={17} />
                      实例运行文件夹
                    </button>
                  </li>
                </ul>
              )}
            </div>
          </li>
        ))}
        {state.installed.length === 0 && (
          <li className="empty-hint">尚未安装任何实例，请前往「下载」页面安装。</li>
        )}
      </ul>

      {renameTarget !== undefined && (
        <div className="sheet-backdrop">
          <div className="sheet">
            <div className="card-title">重命名实例</div>
            <div className="installer-row">
              <span>新名称：</span>
              <input
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void renameInstance(); }}
              />
            </div>
            <div className="sheet-actions">
              <button onClick={() => { setRenameTarget(undefined); setRenameValue(''); }}>取消</button>
              <button className="raised-button" onClick={() => void renameInstance()}>确定</button>
            </div>
          </div>
        </div>
      )}

      {deleteTarget !== undefined && (
        <div className="sheet-backdrop">
          <div className="sheet">
            <div className="card-title">确定要删除实例 “{deleteTarget}” 吗？</div>
            <p className="notice-text">
              该实例的整个文件夹都会被永久删除，此操作无法撤销。
              其他继承该版本的实例可能将无法启动。
            </p>
            <div className="sheet-actions">
              <button onClick={() => setDeleteTarget(undefined)}>取消</button>
              <button className="raised-button delete" onClick={() => void deleteInstance()}>删除</button>
            </div>
          </div>
        </div>
      )}

      {modpackPath !== undefined && (
        <ModpackInstallPage state={state} localPath={modpackPath} onClose={() => setModpackPath(undefined)} />
      )}

      {exportTarget !== undefined && (
        <ModpackExportSheet state={state} instanceId={exportTarget} onClose={() => setExportTarget(undefined)} />
      )}
      {updateFor !== undefined && (
        <ModpackVersionsPage state={state} instanceId={updateFor} onClose={() => setUpdateFor(undefined)} />
      )}
    </div>
  );
}

function InstanceSettingsPanel({
  instanceId,
  derivedIcon,
  onIconChanged
}: {
  instanceId: string;
  /**
   * The icon the list would draw for this instance right now, so the preview
   * shows what the instance actually looks like before anything is picked.
   */
  derivedIcon: string | undefined;
  /**
   * Reloads the instance list. The card icon is derived in the main process, so
   * the list has to ask for it again — HMCL instead invalidates
   * `iconImageProperty` and every cell redraws on its own.
   */
  onIconChanged: () => Promise<void>;
}): React.JSX.Element {
  const [settings, setSettings] = useState<InstanceSettingsDto | undefined>(undefined);
  const [systemMemory, setSystemMemory] = useState<number | undefined>(undefined);
  const [iconData, setIconData] = useState<string | undefined>(undefined);
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [quickMode, setQuickMode] = useState<'none' | 'multiplayer' | 'singleplayer' | 'realms'>('none');

  useEffect(() => {
    let cancelled = false;
    void hmcl().getInstanceSettings(instanceId).then((s) => {
      if (cancelled) return;
      setSettings(s);
      const quick = s.quickPlay ??
        (s.server !== undefined && s.server !== '' ? 'multiplayer' : 'none');
      setQuickMode(quick);
    });
    void hmcl().readInstanceIcon(instanceId).then((data) => {
      if (!cancelled) setIconData(data);
    });
    void hmcl().getSystemMemory().then(setSystemMemory);
    return () => {
      cancelled = true;
    };
  }, [instanceId]);

  const save = (patch: Partial<InstanceSettingsDto>): void => {
    // Undefined patch values clear the stored key instead of being dropped,
    // so fields can fall back to their inherited defaults.
    const next: InstanceSettingsDto = { ...settings } as InstanceSettingsDto;
    for (const entry of Object.entries(patch)) {
      if (entry[1] === undefined) {
        delete (next as Record<string, unknown>)[entry[0]];
      } else {
        (next as Record<string, unknown>)[entry[0]] = entry[1];
      }
    }
    setSettings(next);
    void hmcl().saveInstanceSettings(instanceId, next);
  };

  const clearSetting = (key: keyof InstanceSettingsDto): void => {
    const next: InstanceSettingsDto = { ...settings } as InstanceSettingsDto;
    delete (next as Record<string, unknown>)[key as string];
    setSettings(next);
    void hmcl().saveInstanceSettings(instanceId, next);
  };

  const pickJava = async (): Promise<void> => {
    const path = await hmcl().pickJavaExecutable();
    if (path !== undefined) save({ javaExecutable: path });
  };

  const clearJava = (): void => clearSetting('javaExecutable');

  /** Records a built-in icon and closes the picker, as `GameInstanceIconDialog` does. */
  const chooseIconType = (iconType: string): void => {
    forgetInstanceIcon(instanceId);
    setIconPickerOpen(false);
    void (async () => {
      await hmcl().setInstanceIconType(instanceId, iconType);
      save({ icon: iconType });
      // Only now that the icon is on disk does the list have a new icon to read.
      await onIconChanged();
    })();
  };

  /** Copies a chosen image in as the icon, which outranks any built-in icon. */
  const chooseIconFile = (): void => {
    forgetInstanceIcon(instanceId);
    void hmcl().pickInstanceIcon(instanceId).then(async (data) => {
      setIconData(data);
      setIconPickerOpen(false);
      clearSetting('icon');
      await onIconChanged();
    });
  };

  if (settings === undefined) {
    return (
      <div className="instance-settings-page instance-settings-panel">
        <div className="settings-page-body"><div className="spinner" /></div>
      </div>
    );
  }

  const javaMode = settings.javaExecutable ? 'custom' : 'auto';

  return (
    <div className="instance-settings-page instance-settings-panel">
      <div className="settings-page-body">
        <div className="settings-section">
          <div className="settings-section-title">基本设置</div>
          <div className="settings-section-list">
          <div className="settings-row">
            <div className="settings-row-label">
              <span>版本隔离</span>
              <span className="settings-row-subtitle">启用后，当前实例将使用独立的游戏运行路径设置</span>
            </div>
            <select
              value={settings.gameDirType ?? 'inherit'}
              onChange={(e) => {
                const value = e.target.value;
                if (value === 'inherit') clearSetting('gameDirType');
                else save({ gameDirType: value as 'global' | 'instance' });
              }}
            >
              <option value="inherit">默认 (继承全局设置)</option>
              <option value="global">全局</option>
              <option value="instance">隔离</option>
            </select>
          </div>

          <div className="settings-row">
            <div className="settings-row-label">
              <span>游戏图标</span>
              <span className="settings-row-subtitle">
                {iconData !== undefined
                  ? '当前使用自定义图片'
                  : (settings.icon !== undefined
                      ? `当前使用内置图标 ${settings.icon}`
                      : '未设置时按加载器和游戏版本自动选择')}
              </span>
            </div>
            <div className="settings-row-control instance-icon-control">
              <img
                className="instance-icon-preview"
                src={iconData ?? instanceIconAsset(derivedIcon)}
                alt="实例图标"
              />
              <button className="border-button" onClick={() => setIconPickerOpen(true)}>
                设置图标
              </button>
              {(iconData !== undefined || settings.icon !== undefined) && (
                <button
                  className="border-button"
                  onClick={() => {
                    forgetInstanceIcon(instanceId);
                    setIconData(undefined);
                    void hmcl().clearInstanceIcon(instanceId).then(onIconChanged);
                    clearSetting('icon');
                  }}
                >
                  清除
                </button>
              )}
            </div>
          </div>
          </div>
        </div>

        <div className="settings-section">
          <div className="settings-section-title">游戏设置</div>
          <div className="settings-section-list">
          <div className="settings-row">
            <div className="settings-row-label">
              <span>游戏 Java</span>
              <span className="settings-row-subtitle">选择自动检测或指定 JRE 路径</span>
            </div>
            <div className="settings-row-control java-runtime-control">
              <label className="radio-option">
                <input
                  type="radio"
                  name="java-mode"
                  checked={javaMode === 'auto'}
                  onChange={() => clearJava()}
                />
                <span>自动检测</span>
              </label>
              <label className="radio-option">
                <input
                  type="radio"
                  name="java-mode"
                  checked={javaMode === 'custom'}
                  onChange={() => {}}
                />
                <span>自定义路径</span>
              </label>
              {javaMode === 'custom' && (
                <div className="java-path-input">
                  <input
                    type="text"
                    value={settings.javaExecutable ?? ''}
                    placeholder="选择 Java 可执行文件"
                    readOnly
                  />
                  <button className="border-button" onClick={pickJava} title="浏览">浏览</button>
                </div>
              )}
            </div>
          </div>

          <div className="settings-section">
            <div className="settings-section-title">游戏内存</div>
            <div className="settings-section-list">
            <div className="settings-row">
              <div className="settings-row-label">
                <span>内存分配</span>
                <span className="settings-row-subtitle">自动或手动指定堆大小</span>
              </div>
              <div className="settings-row-control">
                <label className="radio-option">
                  <input
                    type="radio"
                    name="memory-mode"
                    checked={settings.autoMemory !== false}
                    onChange={(e) => save({ autoMemory: e.target.checked })}
                  />
                  <span>自动分配内存</span>
                </label>
                <label className="radio-option">
                  <input
                    type="radio"
                    name="memory-mode"
                    checked={settings.autoMemory === false}
                    onChange={(e) => save({ autoMemory: e.target.checked })}
                  />
                  <span>手动选择内存</span>
                </label>
              </div>
            </div>

            {settings.autoMemory === false && (
              <>
                <div className="settings-row">
                  <div className="settings-row-label">
                    <span>最低内存分配</span>
                    <span className="settings-row-subtitle">初始堆大小 (MiB)</span>
                  </div>
                  <div className="settings-row-control memory-input">
                    <input
                      type="number"
                      value={settings.minMemory ?? 512}
                      onChange={(e) => {
                        const value = Number(e.target.value);
                        save(value > 0 ? { minMemory: value } : {});
                      }}
                    />
                    <span>MiB</span>
                  </div>
                </div>

                <div className="settings-row">
                  <div className="settings-row-label">
                    <span>最大内存</span>
                    <span className="settings-row-subtitle">最大堆大小 (MiB)</span>
                  </div>
                  <div className="settings-row-control memory-input">
                    <input
                      type="number"
                      value={settings.maxMemory ?? 4096}
                      onChange={(e) => {
                        const value = Number(e.target.value);
                        save(value > 0 ? { maxMemory: value } : {});
                      }}
                    />
                    <span>MiB</span>
                  </div>
                </div>

                {systemMemory && settings.maxMemory && (
                  <div className="settings-row memory-bar-row">
                    <div className="settings-row-label">
                      <span>内存占用</span>
                      <span className="settings-row-subtitle">
                        已分配 {formatMiB(settings.maxMemory)} / 系统共 {formatMiB(systemMemory)}
                      </span>
                    </div>
                    <div className="settings-row-control memory-bar-container">
                      <div className="memory-bar-track">
                        <div
                          className="memory-bar-fill"
                          style={{
                            width: `${Math.min(100, (settings.maxMemory / systemMemory) * 100)}%`
                          }}
                        />
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
            </div>
          </div>

          <div className="settings-section">
            <div className="settings-section-title">游戏窗口类型</div>
            <div className="settings-section-list">
            <div className="settings-row">
              <div className="settings-row-label">
                <span>窗口模式</span>
                <span className="settings-row-subtitle">选择启动时的窗口状态</span>
              </div>
              <select
                value={settings.windowType ?? (settings.fullscreen ? 'fullscreen' : 'windowed')}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === 'fullscreen') save({ windowType: 'fullscreen', fullscreen: false });
                  else if (v === 'maximized') save({ windowType: 'maximized', fullscreen: false });
                  else {
                    clearSetting('windowType');
                    save({ fullscreen: false });
                  }
                }}
              >
                <option value="windowed">窗口化</option>
                <option value="maximized">最大化</option>
                <option value="fullscreen">全屏</option>
              </select>
            </div>

            {(settings.windowType ?? 'windowed') === 'windowed' && settings.width !== undefined && settings.height !== undefined && (
              <div className="settings-row">
                <div className="settings-row-label">
                  <span>分辨率</span>
                  <span className="settings-row-subtitle">窗口化时的初始大小</span>
                </div>
                <div className="settings-row-control resolution-input">
                  <input
                    type="number"
                    value={settings.width}
                    min={320}
                    max={7680}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      save(v > 0 ? { width: v } : {});
                    }}
                  />
                  <span>×</span>
                  <input
                    type="number"
                    value={settings.height}
                    min={240}
                    max={4320}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      save(v > 0 ? { height: v } : {});
                    }}
                  />
                </div>
              </div>
            )}
            </div>
          </div>

          <div className="settings-section">
            <div className="settings-section-title">快速游玩</div>
            <div className="settings-section-list">
            <div className="settings-row">
              <div className="settings-row-label">
                <span>快速游玩选项</span>
                <span className="settings-row-subtitle">启动游戏后直接进入指定服务器或世界</span>
              </div>
              <select
                value={quickMode}
                onChange={(e) => {
                  const value = e.target.value as 'none' | 'multiplayer' | 'singleplayer' | 'realms';
                  setQuickMode(value);
                  save({ quickPlay: value });
                }}
              >
                <option value="none">无</option>
                <option value="multiplayer">多人联机</option>
                <option value="singleplayer">单人游戏</option>
                <option value="realms">Realms</option>
              </select>
            </div>

            {quickMode === 'multiplayer' && (
              <div className="settings-row">
                <div className="settings-row-label">
                  <span>服务器地址</span>
                  <span className="settings-row-subtitle">支持服务器地址 (host:port)</span>
                </div>
                <input
                  type="text"
                  value={settings.server ?? ''}
                  placeholder="mc.example.com:25565"
                  onChange={(e) => save(e.target.value ? { server: e.target.value } : {})}
                />
              </div>
            )}

            {quickMode === 'singleplayer' && (
              <div className="settings-row">
                <div className="settings-row-label">
                  <span>世界名称</span>
                  <span className="settings-row-subtitle">启动后直接进入指定世界</span>
                </div>
                <input
                  type="text"
                  value={settings.quickPlayWorld ?? ''}
                  placeholder="MyWorld"
                  onChange={(e) => save(e.target.value ? { quickPlayWorld: e.target.value } : {})}
                />
              </div>
            )}
            </div>
          </div>

          <div className="settings-section">
            <div className="settings-section-title">高级选项</div>
            <div className="settings-section-list">
            <div className="settings-row">
              <div className="settings-row-label">
                <span>游戏运行路径</span>
                <span className="settings-row-subtitle">当前实例启动时的游戏路径策略</span>
              </div>
              <select
                value={settings.gameDirType === 'instance' ? 'instance' : 'default'}
                disabled
              >
                <option value="default">默认 (".minecraft/")</option>
                <option value="instance">各实例独立 (存放在 ".minecraft/versions/{instanceId}/"，除 assets、libraries 外)</option>
              </select>
            </div>

            <div className="settings-row">
              <div className="settings-row-label">
                <span>游戏参数</span>
                <span className="settings-row-subtitle">传递给 Minecraft 的额外参数</span>
              </div>
              <input
                type="text"
                value={settings.gameArguments ?? ''}
                placeholder="--username Player"
                onChange={(e) => save(e.target.value ? { gameArguments: e.target.value } : {})}
              />
            </div>

            <div className="settings-row">
              <div className="settings-row-label">
                <span>环境变量</span>
                <span className="settings-row-subtitle">传递给游戏进程的键值对</span>
              </div>
              <textarea
                value={settings.environmentVariables ?? ''}
                placeholder="LD_PRELOAD=/path/lib.so;MY_VAR=value"
                rows={3}
                onChange={(e) => save(e.target.value ? { environmentVariables: e.target.value } : {})}
              />
            </div>

            <div className="settings-row">
              <div className="settings-row-label">
                <span>进程优先级</span>
                <span className="settings-row-subtitle">调度优先级</span>
              </div>
              <select
                value={settings.processPriority ?? 'normal'}
                onChange={(e) => {
                  const val = e.target.value;
                  save({ processPriority: val as InstanceSettingsDto['processPriority'] } as Partial<InstanceSettingsDto>);
                }}
              >
                <option value="normal">中</option>
                <option value="above_normal">较高</option>
                <option value="high">高</option>
                <option value="below_normal">较低</option>
                <option value="low">低</option>
              </select>
            </div>
            </div>
          </div>
          </div>
        </div>

        <div className="settings-section">
          <div className="settings-section-title">Java 虚拟机设置</div>
          <div className="settings-section-list">
          <div className="settings-row">
            <div className="settings-row-label">
              <span>不添加默认的 Java 虚拟机参数</span>
              <span className="settings-row-subtitle">不自动向启动命令附加默认 JVM 参数</span>
            </div>
            <input
              type="checkbox"
              checked={settings.noJvmArgs === true}
              onChange={(e) => save({ noJvmArgs: e.target.checked })}
            />
          </div>

          <div className="settings-row">
            <div className="settings-row-label">
              <span>不自动添加 Java 虚拟机优化参数</span>
              <span className="settings-row-subtitle">不自动向启动命令附加 G1GC 等优化参数</span>
            </div>
            <input
              type="checkbox"
              checked={settings.noOptimizingJVMArgs === true}
              onChange={(e) => save({ noOptimizingJVMArgs: e.target.checked })}
            />
          </div>

          <div className="settings-row">
            <div className="settings-row-label">
              <span>不检查 Java 虚拟机与游戏的兼容性</span>
              <span className="settings-row-subtitle">跳过 Java 版本与游戏要求的一致性检查</span>
            </div>
            <input
              type="checkbox"
              checked={settings.dontCheckJvmValidity === true}
              onChange={(e) => save({ dontCheckJvmValidity: e.target.checked })}
            />
          </div>

          <div className="settings-row">
            <div className="settings-row-label">
              <span>Java 虚拟机参数</span>
              <span className="settings-row-subtitle">额外的 JVM 参数 (与全局设置合并)</span>
            </div>
            <textarea
              value={settings.javaArgs ?? ''}
              placeholder="-Xmx2g -Xms512m -XX:+UseG1GC"
              rows={2}
              onChange={(e) => save(e.target.value ? { javaArgs: e.target.value } : {})}
            />
          </div>

          <div className="settings-section">
            <div className="settings-section-title">已弃用的 JVM 内存选项</div>
            <div className="settings-section-list">
            <div className="settings-row">
              <div className="settings-row-label">
                <span>内存永久保存区域</span>
                <span className="settings-row-subtitle">只用于兼容旧版本</span>
              </div>
              <div className="settings-row-control memory-input">
                <input
                  type="number"
                  value={settings.permSize ?? 512}
                  min={0}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    save(v > 0 ? { permSize: v } : {});
                  }}
                />
                <span>MiB</span>
              </div>
            </div>
            </div>
          </div>
          </div>
        </div>

        <div className="settings-section">
          <div className="settings-section-title">自定义命令</div>
          <div className="settings-section-list">
          <div className="settings-row">
            <div className="settings-row-label">
              <span>游戏启动前执行命令</span>
              <span className="settings-row-subtitle">将在游戏启动前调用</span>
            </div>
            <input
              type="text"
              value={settings.precallCommand ?? ''}
              placeholder="echo start"
              onChange={(e) => save(e.target.value ? { precallCommand: e.target.value } : {})}
            />
          </div>

          <div className="settings-row">
            <div className="settings-row-label">
              <span>包装命令</span>
              <span className="settings-row-subtitle">如填写"optirun"后，启动命令将从"java ..."变为"optirun java ..."</span>
            </div>
            <input
              type="text"
              value={settings.wrapper ?? ''}
              placeholder="optirun"
              onChange={(e) => save(e.target.value ? { wrapper: e.target.value } : {})}
            />
          </div>

          <div className="settings-row">
            <div className="settings-row-label">
              <span>游戏结束后执行命令</span>
              <span className="settings-row-subtitle">将在游戏结束后调用</span>
            </div>
            <input
              type="text"
              value={settings.postExitCommand ?? ''}
              placeholder="echo done"
              onChange={(e) => save(e.target.value ? { postExitCommand: e.target.value } : {})}
            />
          </div>
          </div>
        </div>

        <div className="settings-section">
          <div className="settings-section-title">图形设置</div>
          <div className="settings-section-list">
          <div className="settings-row">
            <div className="settings-row-label">
              <span>图形 API</span>
              <span className="settings-row-subtitle">仅对 Minecraft 26.2+ 生效</span>
            </div>
            <select
              value={settings.graphicsBackend ?? 'default'}
              onChange={(e) => {
                const v = e.target.value as 'default' | 'opengl' | 'vulkan';
                if (v === 'default') clearSetting('graphicsBackend');
                else save({ graphicsBackend: v });
              }}
            >
              <option value="default">默认</option>
              <option value="opengl">OpenGL</option>
              <option value="vulkan">Vulkan</option>
            </select>
          </div>
          </div>
        </div>

        <div className="settings-section">
          <div className="settings-section-title">本地库设置</div>
          <div className="settings-section-list">
          <div className="settings-row">
            <div className="settings-row-label">
              <span>使用自定义本地库</span>
              <span className="settings-row-subtitle">使用指定目录的本地库替代解压出的原生库</span>
            </div>
            <input
              type="checkbox"
              checked={settings.useCustomNatives === true}
              onChange={(e) => save({ useCustomNatives: e.target.checked })}
            />
          </div>

          {settings.useCustomNatives && (
            <div className="settings-row">
              <div className="settings-row-label">
                <span>本地库路径</span>
              </div>
              <input
                type="text"
                value={settings.nativesDirectory ?? ''}
                placeholder="/path/to/natives"
                onChange={(e) => save(e.target.value ? { nativesDirectory: e.target.value } : {})}
              />
            </div>
          )}

          <div className="settings-row">
            <div className="settings-row-label">
              <span>不尝试自动替换本地库</span>
              <span className="settings-row-subtitle">跳过系统本地库的自动修补</span>
            </div>
            <input
              type="checkbox"
              checked={settings.notPatchNatives === true}
              onChange={(e) => save({ notPatchNatives: e.target.checked })}
            />
          </div>

          <div className="settings-row">
            <div className="settings-row-label">
              <span>使用本地 GLFW/SDL</span>
              <span className="settings-row-subtitle">仅 Linux / FreeBSD</span>
            </div>
            <input
              type="checkbox"
              checked={settings.useNativeGlfwSdl === true}
              onChange={(e) => save({ useNativeGlfwSdl: e.target.checked })}
            />
          </div>

          <div className="settings-row">
            <div className="settings-row-label">
              <span>使用本地 OpenAL</span>
              <span className="settings-row-subtitle">仅 Linux / FreeBSD</span>
            </div>
            <input
              type="checkbox"
              checked={settings.useNativeOpenAL === true}
              onChange={(e) => save({ useNativeOpenAL: e.target.checked })}
            />
          </div>
          </div>
        </div>

        <div className="settings-section">
          <div className="settings-section-title">启动器设置</div>
          <div className="settings-section-list">
          <div className="settings-row">
            <div className="settings-row-label">
              <span>启动器可见性</span>
              <span className="settings-row-subtitle">游戏启动后启动器窗口的显示行为</span>
            </div>
            <select
              value={settings.launcherVisibility ?? 'keep'}
              onChange={(e) => {
                const v = e.target.value as 'keep' | 'hide' | 'close' | 'hide_and_reopen';
                save({ launcherVisibility: v });
              }}
            >
              <option value="keep">保持可见</option>
              <option value="hide">隐藏</option>
              <option value="close">关闭启动器</option>
              <option value="hide_and_reopen">隐藏后自动恢复</option>
            </select>
          </div>

          <div className="settings-row">
            <div className="settings-row-label">
              <span>允许修改游戏</span>
              <span className="settings-row-subtitle">允许通过附加 Java Agent 修改游戏以改善游戏体验</span>
            </div>
            <input
              type="checkbox"
              checked={settings.allowAutoAgent === true}
              onChange={(e) => save({ allowAutoAgent: e.target.checked })}
            />
          </div>

          <div className="settings-row">
            <div className="settings-row-label">
              <span>不自动切换游戏语言</span>
            </div>
            <input
              type="checkbox"
              checked={settings.disableAutoGameOptions === true}
              onChange={(e) => save({ disableAutoGameOptions: e.target.checked })}
            />
          </div>

          <div className="settings-row">
            <div className="settings-row-label">
              <span>查看日志</span>
              <span className="settings-row-subtitle">启动遇到问题时自动打开日志</span>
            </div>
            <input
              type="checkbox"
              checked={settings.showLogs === true}
              onChange={(e) => save({ showLogs: e.target.checked })}
            />
          </div>

          <div className="settings-row">
            <div className="settings-row-label">
              <span>输出调试日志</span>
            </div>
            <input
              type="checkbox"
              checked={settings.enableDebugLogOutput === true}
              onChange={(e) => save({ enableDebugLogOutput: e.target.checked })}
            />
          </div>

          <div className="settings-row">
            <div className="settings-row-label">
              <span>不检查游戏完整性</span>
              <span className="settings-row-subtitle">跳过启动前对游戏文件的完整性检查</span>
            </div>
            <input
              type="checkbox"
              checked={settings.dontCheckGameCompleteness === true}
              onChange={(e) => save({ dontCheckGameCompleteness: e.target.checked })}
            />
          </div>
          </div>
        </div>
      </div>
      {iconPickerOpen && (
        <InstanceIconPickerSheet
          current={iconData !== undefined ? undefined : settings.icon}
          onPickType={chooseIconType}
          onPickFile={chooseIconFile}
          onClose={() => setIconPickerOpen(false)}
        />
      )}
    </div>
  );
}

// ----- Instance management page (HMCL GameInstancePage) -----

type InstanceTab = 'settings' | 'installers' | 'mods' | 'resourcepacks' | 'worlds' | 'schematics';

// The drawer items are the tabs (HMCL renders no visible tab bar; the six
// navigation-drawer rows *are* the TabHeader). Each carries an outlined and a
// filled glyph so the active row can cross-fade, as addNavigationDrawerTab does.
const INSTANCE_TABS: {
  id: InstanceTab;
  label: string;
  icon: React.JSX.Element;
  activeIcon: React.JSX.Element;
}[] = [
  { id: 'settings', label: '游戏设置', icon: <SettingsIcon size={20} />, activeIcon: <SettingsFillIcon size={20} /> },
  { id: 'installers', label: '自动安装', icon: <DeployedCodeIcon size={20} />, activeIcon: <DeployedCodeFillIcon size={20} /> },
  { id: 'mods', label: '模组管理', icon: <ExtensionIcon size={20} />, activeIcon: <ExtensionFillIcon size={20} /> },
  { id: 'resourcepacks', label: '资源包管理', icon: <TextureIcon size={20} />, activeIcon: <TextureIcon size={20} /> },
  { id: 'worlds', label: '世界管理', icon: <PublicIcon size={20} />, activeIcon: <PublicIcon size={20} /> },
  { id: 'schematics', label: '原理图管理', icon: <SchemaIcon size={20} />, activeIcon: <SchemaFillIcon size={20} /> }
];

/** 浏览 submenu targets, mirroring GameInstancePage.Skin's browseList (icon + label). */
const INSTANCE_BROWSE_TARGETS: { label: string; folder: InstanceFolder; icon: React.JSX.Element }[] = [
  { label: '实例运行文件夹', folder: '', icon: <GamepadIcon size={20} /> },
  { label: '模组文件夹', folder: 'mods', icon: <ExtensionIcon size={20} /> },
  { label: '资源包文件夹', folder: 'resourcepacks', icon: <TextureIcon size={20} /> },
  { label: '世界文件夹', folder: 'saves', icon: <PublicIcon size={20} /> },
  { label: '原理图文件夹', folder: 'schematics', icon: <SchemaIcon size={20} /> },
  { label: '光影包文件夹', folder: 'shaderpacks', icon: <SunnyIcon size={20} /> },
  { label: '截图文件夹', folder: 'screenshots', icon: <ScreenshotIcon size={20} /> },
  { label: '配置文件夹', folder: 'config', icon: <SettingsIcon size={20} /> },
  { label: '日志文件夹', folder: 'logs', icon: <ScriptIcon size={20} /> },
  { label: '崩溃报告文件夹', folder: 'crash-reports', icon: <BugIcon size={20} /> }
];

function InstanceManagePage({ state }: StateHookProps): React.JSX.Element {
  const instanceId = state.managingId;
  const [tab, setTab] = useState<InstanceTab>('settings');
  const [browseOpen, setBrowseOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<string | undefined>(undefined);
  const [renameValue, setRenameValue] = useState('');
  /** Pending destructive delete; the instance is only removed once confirmed. */
  const [deleteTarget, setDeleteTarget] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (instanceId === undefined) return;
    setTab('settings');
    setBrowseOpen(false);
    setManageOpen(false);
    setDeleteTarget(undefined);
  }, [instanceId]);

  if (instanceId === undefined) return <></>;

  const launchTest = (): void => {
    if (state.busy) return;
    state.setBusy(true);
    state.appendLog({ text: `>>> 测试启动 ${instanceId}`, isError: false });
    hmcl()
      .launch(instanceId)
      .catch((error: unknown) => {
        state.reportLaunchFailure(error);
      });
  };

  const renameInstance = async (): Promise<void> => {
    if (renameTarget === undefined || renameValue === '') return;
    try {
      await hmcl().renameInstance(renameTarget, renameValue);
      setRenameTarget(undefined);
      setRenameValue('');
      await state.refreshInstalled();
      if (renameTarget === instanceId) state.setManagingId(renameValue);
    } catch (error) {
      state.appendLog({ text: `重命名失败: ${String(error)}`, isError: true });
    }
  };

  const duplicateInstance = async (): Promise<void> => {
    const newId = `${instanceId}_copy`;
    try {
      await hmcl().copyInstance(instanceId, newId);
      await state.refreshInstalled();
      state.appendLog({ text: `已复制实例: ${newId}`, isError: false });
    } catch (error) {
      state.appendLog({ text: `复制失败: ${String(error)}`, isError: true });
    }
  };

  /**
   * Permanently removes the instance directory. Destructive and irreversible,
   * so it is only ever reached from the confirmation sheet.
   */
  const removeInstance = async (): Promise<void> => {
    if (deleteTarget !== instanceId) return;
    setDeleteTarget(undefined);
    try {
      await hmcl().deleteInstance(instanceId);
      await state.refreshInstalled();
      state.setManagingId(undefined);
    } catch (error) {
      state.appendLog({ text: `删除失败: ${String(error)}`, isError: true });
    }
  };

  const clearAssets = async (): Promise<void> => {
    try {
      await hmcl().deleteRemoteAssets(instanceId);
      state.appendLog({ text: '已删除资源文件', isError: false });
    } catch (error) {
      state.appendLog({ text: String(error), isError: true });
    }
  };

  return (
    <div className="instance-manage-page">
      <div className="instance-manage-body">
        <aside className="dl-sidebar instance-manage-sidebar">
          <div className="instance-tabs" role="tablist" aria-label="实例管理">
            {INSTANCE_TABS.map((item) => (
              <button
                key={item.id}
                role="tab"
                aria-selected={tab === item.id}
                className={`advanced-list-item${tab === item.id ? ' selected' : ''}`}
                onClick={() => setTab(item.id)}
              >
                <span className="advanced-list-item-icon">
                  {tab === item.id ? item.activeIcon : item.icon}
                </span>
                <span className="advanced-list-item-label">{item.label}</span>
              </button>
            ))}
          </div>

          {/* Pinned bottom toolbar (HMCL AdvancedListBox, height 40*4 + 12*2 = 184). */}
          <div className="instance-toolbar">
            <button
              className="advanced-list-item instance-toolbar-item"
              title="更新整合包"
              disabled
            >
              <span className="advanced-list-item-icon"><UpdateIcon size={20} /></span>
              <span className="advanced-list-item-label">更新整合包</span>
            </button>
            <button
              className="advanced-list-item instance-toolbar-item"
              disabled={state.busy}
              onClick={() => void launchTest()}
            >
              <span className="advanced-list-item-icon"><RocketIcon size={20} /></span>
              <span className="advanced-list-item-label">测试游戏</span>
            </button>
            <div className="instance-toolbar-wrap">
              <button
                className="advanced-list-item instance-toolbar-item"
                aria-haspopup="menu"
                aria-expanded={browseOpen}
                onClick={() => {
                  setBrowseOpen((open) => !open);
                  setManageOpen(false);
                }}
              >
                <span className="advanced-list-item-icon"><FolderOpenIcon size={20} /></span>
                <span className="advanced-list-item-label">浏览</span>
              </button>
              {browseOpen && (
                <ul className="dropdown-menu instance-popup" role="menu">
                  {INSTANCE_BROWSE_TARGETS.map((target) => (
                    <li key={target.folder}>
                      <button
                        role="menuitem"
                        onClick={() => {
                          setBrowseOpen(false);
                          void hmcl().openInstanceFolder(instanceId, target.folder);
                        }}
                      >
                        {target.icon}
                        {target.label}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="instance-toolbar-wrap">
              <button
                className="advanced-list-item instance-toolbar-item"
                aria-haspopup="menu"
                aria-expanded={manageOpen}
                onClick={() => {
                  setManageOpen((open) => !open);
                  setBrowseOpen(false);
                }}
              >
                <span className="advanced-list-item-icon"><MenuIcon size={20} /></span>
                <span className="advanced-list-item-label">管理</span>
              </button>
              {manageOpen && (
                <ul className="dropdown-menu instance-popup" role="menu">
                  <li>
                    <button role="menuitem" onClick={() => { setManageOpen(false); void launchTest(); }}>
                      <RocketIcon size={20} /> 测试游戏
                    </button>
                  </li>
                  <li className="menu-separator" />
                  <li>
                    <button role="menuitem" onClick={() => { setManageOpen(false); setRenameTarget(instanceId); setRenameValue(instanceId); }}>
                      <EditIcon size={20} /> 重命名该实例
                    </button>
                  </li>
                  <li>
                    <button role="menuitem" onClick={() => { setManageOpen(false); void duplicateInstance(); }}>
                      <FolderCopyIcon size={20} /> 复制游戏实例
                    </button>
                  </li>
                  <li>
                    <button role="menuitem" className="delete" onClick={() => { setManageOpen(false); setDeleteTarget(instanceId); }}>
                      <DeleteForeverIcon size={20} /> 删除该实例
                    </button>
                  </li>
                  <li className="menu-separator" />
                  <li>
                    <button role="menuitem" onClick={() => { setManageOpen(false); void clearAssets(); }}>
                      删除所有游戏资源文件
                    </button>
                  </li>
                  <li>
                    <button role="menuitem" onClick={() => { setManageOpen(false); void hmcl().clearLibraries(); }}>
                      删除所有库文件
                    </button>
                  </li>
                  <li>
                    <button
                      role="menuitem"
                      title="清理 logs 和 crash-reports 文件夹"
                      onClick={() => { setManageOpen(false); void hmcl().cleanInstance(instanceId); }}
                    >
                      清理游戏文件夹
                    </button>
                  </li>
                </ul>
              )}
            </div>
          </div>
        </aside>
        <main className="dl-main instance-manage-main">
          <div className="instance-tab-stage" key={tab}>
            {tab === 'settings' && (
              <InstanceSettingsPanel
                instanceId={instanceId}
                derivedIcon={state.installed.find((entry) => entry.id === instanceId)?.icon}
                onIconChanged={state.refreshInstalled}
                key={instanceId}
              />
            )}
            {tab === 'installers' && <InstallersTab state={state} instanceId={instanceId} key={instanceId} />}
            {tab === 'mods' && (
              <FolderListTab instanceId={instanceId} folder="mods" title="模组管理" subtitle=".jar / .disabled 文件" />
            )}
            {tab === 'resourcepacks' && (
              <FolderListTab instanceId={instanceId} folder="resourcepacks" title="资源包管理" subtitle=".zip / 文件夹" />
            )}
            {tab === 'worlds' && (
              <FolderListTab instanceId={instanceId} folder="saves" title="世界管理" subtitle="世界文件夹" />
            )}
            {tab === 'schematics' && (
              <FolderListTab instanceId={instanceId} folder="schematics" title="原理图管理" subtitle=".nbt / .schem / .schematic" />
            )}
          </div>
        </main>
      </div>

      {renameTarget !== undefined && (
        <>
          <div className="sheet-backdrop">
            <div className="sheet">
              <div className="card-title">重命名实例</div>
              <div className="installer-row">
                <span>请输入要修改的名称：</span>
                <input
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void renameInstance(); }}
                />
              </div>
              <div className="sheet-actions">
                <button onClick={() => { setRenameTarget(undefined); setRenameValue(''); }}>取消</button>
                <button className="raised-button" onClick={() => void renameInstance()}>确定</button>
              </div>
            </div>
          </div>
          <button className="menu-backdrop" aria-label="关闭" onClick={() => setRenameTarget(undefined)} />
        </>
      )}

      {deleteTarget !== undefined && (
        <>
          <div className="sheet-backdrop">
            <div className="sheet">
              <div className="card-title">确定要删除实例 “{deleteTarget}” 吗？</div>
              <p className="notice-text">
                该实例的整个文件夹都会被永久删除，此操作无法撤销。
                其他继承该版本的实例可能将无法启动。
              </p>
              <div className="sheet-actions">
                <button onClick={() => setDeleteTarget(undefined)}>取消</button>
                <button className="raised-button delete" onClick={() => void removeInstance()}>删除</button>
              </div>
            </div>
          </div>
          <button className="menu-backdrop" aria-label="关闭" onClick={() => setDeleteTarget(undefined)} />
        </>
      )}
    </div>
  );
}

/** 自动安装 tab: installs a loader/build from the instance's game version. */
function InstallersTab({
  state,
  instanceId
}: StateHookProps & { instanceId: string }): React.JSX.Element {
  const instance = state.installed.find((version) => version.id === instanceId);
  const gameVersion = instance?.gameVersion;

  const install = async (kind: LoaderKind): Promise<void> => {
    if (gameVersion === undefined) return;
    try {
      const versions = await hmcl().fetchLoaderVersions(kind, gameVersion);
      const latest = versions.find((v) => v.stable) ?? versions[0];
      if (latest === undefined) {
        state.appendLog({ text: `没有可用的 ${kind} 版本`, isError: true });
        return;
      }
      const newId = await hmcl().installLoader(kind, gameVersion, latest.id);
      await state.refreshInstalled();
      state.appendLog({ text: `已安装 ${kind}，新实例: ${newId}`, isError: false });
    } catch (error) {
      state.appendLog({ text: `安装 ${kind} 失败: ${String(error)}`, isError: true });
    }
  };

  if (gameVersion === undefined) {
    return (
      <div className="settings-scroll">
        <div className="settings-page-body"><div className="spinner" /></div>
      </div>
    );
  }

  const installedMarkers = new Set<string>(
    state.installed.find((entry) => entry.id === instanceId)?.loaders.map((loader) => loader.slug) ?? []
  );

  return (
    <div className="settings-scroll">
      <SettingsTabHeader title="自动安装" subtitle={`为 ${instanceId} (${gameVersion}) 安装加载器时会创建新的继承实例`} />
      <div className="component-title">安装器</div>
      <div className="card settings-card">
        {(['fabric', 'forge', 'neoforge', 'optifine'] as LoaderKind[]).map((kind) => (
          <div key={kind} className="installer-row">
            <div>
              <div className="primary">{KIND_LABELS[kind]}</div>
              <div className="secondary">
                {installedMarkers.has(kind) ? '当前实例已包含该加载器' : '点击以安装最新版本'}
              </div>
            </div>
            <button
              className="raised-button"
              disabled={state.busy || installedMarkers.has(kind)}
              onClick={() => void install(kind)}
            >
              安装
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Folder management tab used by 模组/资源包/世界/原理图 tabs. */
function FolderListTab({
  instanceId,
  folder,
  title,
  subtitle
}: {
  instanceId: string;
  folder: InstanceFolder;
  title: string;
  subtitle: string;
}): React.JSX.Element {
  const [entries, setEntries] = useState<InstanceFolderEntryDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmName, setConfirmName] = useState<string | undefined>(undefined);

  const reload = useCallback(() => {
    setLoading(true);
    void hmcl()
      .listInstanceFolder(instanceId, folder)
      .then(setEntries)
      .finally(() => setLoading(false));
  }, [instanceId, folder]);

  useEffect(() => {
    reload();
  }, [reload]);

  const remove = async (): Promise<void> => {
    if (confirmName === undefined) return;
    await hmcl().deleteInstanceFile(instanceId, folder, confirmName);
    setConfirmName(undefined);
    reload();
  };

  // A resource pack in the folder is inert until options.txt lists it, which is
  // why the row carries a switch: without one the only way to make a freshly
  // downloaded pack take effect is to enable it inside the running game.
  const isResourcePackFolder = folder === 'resourcepacks';
  const [toggleError, setToggleError] = useState<string | undefined>(undefined);
  const [warnEnable, setWarnEnable] = useState<InstanceFolderEntryDto | undefined>(undefined);

  const writeEnabled = async (entry: InstanceFolderEntryDto, enabled: boolean): Promise<void> => {
    setToggleError(undefined);
    setEntries((current) =>
      current.map((item) => (item.name === entry.name ? { ...item, enabled } : item))
    );
    try {
      await hmcl().setResourcePackEnabled(instanceId, entry.name, enabled);
    } catch (reason) {
      // Put the row back the way the file still has it rather than leaving a
      // switch that lies about the game's state.
      setEntries((current) =>
        current.map((item) => (item.name === entry.name ? { ...item, enabled: !enabled } : item))
      );
      setToggleError(describeInstallError(reason));
    }
  };

  const toggleEnabled = async (entry: InstanceFolderEntryDto): Promise<void> => {
    // Enabling a pack the game would refuse looks like it worked and then does
    // nothing, so it takes one confirmation — the same warning HMCL shows.
    if (!entry.enabled && entry.compatible === false) {
      setWarnEnable(entry);
      return;
    }
    await writeEnabled(entry, !entry.enabled);
  };

  return (
    <div className="settings-scroll">
      <SettingsTabHeader title={title} subtitle={subtitle} />
      <div className="folder-list-toolbar">
        <span className="secondary">{entries.length} 项</span>
        <span className="nav-bar-spacer" />
        <button className="text-button" onClick={() => void hmcl().openInstanceFolder(instanceId, folder)}>
          <ArrowForwardIcon size={15} /> 打开文件夹
        </button>
        <button className="text-button" onClick={reload}>
          <RefreshIcon size={15} /> 刷新
        </button>
      </div>
      <div className="card settings-card">
        {loading ? (
          <div className="spinner" />
        ) : entries.length === 0 ? (
          <div className="empty-hint">该文件夹为空。</div>
        ) : (
          <ul className="folder-list">
            {entries.map((entry) => (
              <li key={entry.name} className="folder-list-item">
                {isResourcePackFolder && !entry.isDirectory ? (
                  <label
                    className="folder-list-switch"
                    title={
                      entry.compatibilityNote ??
                      (entry.enabled ? '已启用' : '已禁用')
                    }
                  >
                    <input
                      type="checkbox"
                      checked={entry.enabled}
                      onChange={() => void toggleEnabled(entry)}
                    />
                    <span className="folder-list-name">{entry.name}</span>
                  </label>
                ) : (
                  <>
                    <span className="folder-list-icon">
                      {entry.isDirectory ? <GameIcon size={18} /> : <ListIcon size={18} />}
                    </span>
                    <span className="folder-list-name">{entry.name}</span>
                  </>
                )}
                {entry.compatible === false && (
                  <span className="folder-list-badge">不兼容</span>
                )}
                <span className="secondary">{entry.isDirectory ? '文件夹' : '文件'}</span>
                <button
                  className="icon-button"
                  title="删除"
                  aria-label="删除"
                  onClick={() => setConfirmName(entry.name)}
                >
                  <DeleteForeverIcon size={17} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {toggleError !== undefined && <div className="field-error">{toggleError}</div>}
      {confirmName !== undefined && (
        <>
          <div className="sheet-backdrop">
            <div className="sheet">
              <div className="card-title">确定要删除 “{confirmName}” 吗？</div>
              <div className="sheet-actions">
                <button onClick={() => setConfirmName(undefined)}>取消</button>
                <button className="raised-button delete" onClick={() => void remove()}>删除</button>
              </div>
            </div>
          </div>
          <button className="menu-backdrop" aria-label="关闭" onClick={() => setConfirmName(undefined)} />
        </>
      )}
      {warnEnable !== undefined && (
        <>
          <div className="sheet-backdrop">
            <div className="sheet">
              <div className="card-title">启用 “{warnEnable.name}” 吗？</div>
              <div className="sheet-text">{warnEnable.compatibilityNote}</div>
              <div className="sheet-actions">
                <button onClick={() => setWarnEnable(undefined)}>取消</button>
                <button
                  className="raised-button"
                  onClick={() => {
                    const entry = warnEnable;
                    setWarnEnable(undefined);
                    void writeEnabled(entry, true);
                  }}
                >
                  仍然启用
                </button>
              </div>
            </div>
          </div>
          <button className="menu-backdrop" aria-label="关闭" onClick={() => setWarnEnable(undefined)} />
        </>
      )}
    </div>
  );
}

const KIND_LABELS: Record<LoaderKind, string> = {
  fabric: 'Fabric',
  forge: 'Forge',
  neoforge: 'NeoForge',
  optifine: 'OptiFine'
};

// ----- Installer components (mirrors HMCL's InstallersPage DEFAULT_INSTALLERS) -----

type InstallerComponentId =
  | LoaderKind
  | 'fabric-api'
  | 'quilt-api'
  | 'quilt'
  | 'cleanroom'
  | 'liteloader'
  | 'legacyfabric'
  | 'legacyfabric-api';

interface InstallerComponentMeta {
  id: InstallerComponentId;
  label: string;
  description: string;
  /** Auto-name suffix; null for API mods so they never alter the instance name. */
  simplified: string | null;
  /** Whether the backend can actually install this component. */
  supported: boolean;
  /** API mods require their loader to be selected first. */
  apiOf?: 'fabric' | 'quilt' | 'legacyfabric';
}

const INSTALLER_COMPONENTS: Record<InstallerComponentId, InstallerComponentMeta> = {
  forge: { id: 'forge', label: 'Forge', description: '安装 Forge 加载器', simplified: 'Forge', supported: true },
  neoforge: { id: 'neoforge', label: 'NeoForge', description: '安装 NeoForge 加载器', simplified: 'NeoForge', supported: true },
  optifine: { id: 'optifine', label: 'OptiFine', description: '安装 OptiFine', simplified: 'OptiFine', supported: true },
  fabric: { id: 'fabric', label: 'Fabric', description: '安装 Fabric 加载器', simplified: 'Fabric', supported: true },
  'fabric-api': { id: 'fabric-api', label: 'Fabric API', description: 'Fabric API 模组', simplified: null, supported: true, apiOf: 'fabric' },
  quilt: { id: 'quilt', label: 'Quilt', description: '安装 Quilt 加载器', simplified: 'Quilt', supported: false },
  'quilt-api': { id: 'quilt-api', label: 'QSL/QFAPI', description: 'Quilt 标准库模组', simplified: null, supported: true, apiOf: 'quilt' },
  cleanroom: { id: 'cleanroom', label: 'Cleanroom', description: '安装 Cleanroom 加载器', simplified: 'Cleanroom', supported: false },
  liteloader: { id: 'liteloader', label: 'LiteLoader', description: '安装 LiteLoader', simplified: 'LiteLoader', supported: false },
  legacyfabric: { id: 'legacyfabric', label: 'Legacy Fabric', description: '安装 Legacy Fabric 加载器', simplified: 'LegacyFabric', supported: false },
  'legacyfabric-api': { id: 'legacyfabric-api', label: 'Legacy Fabric API', description: 'Legacy Fabric API 模组', simplified: null, supported: false, apiOf: 'legacyfabric' }
};

/** Loaders that can be selected as a base simultaneously — mutually exclusive here. */
const MAIN_INSTALLER_KINDS = new Set<InstallerComponentId>(['forge', 'neoforge', 'fabric', 'optifine']);

/** Unsupported component → whether it modifies the version at all. */
const INSTALLER_INCOMPATIBLE: Record<InstallerComponentId, InstallerComponentId[]> = {
  forge: ['fabric', 'quilt', 'neoforge', 'cleanroom', 'legacyfabric', 'fabric-api', 'quilt-api', 'legacyfabric-api'],
  neoforge: ['forge', 'fabric', 'quilt', 'cleanroom', 'legacyfabric', 'optifine', 'fabric-api', 'quilt-api'],
  optifine: ['fabric', 'quilt', 'neoforge', 'cleanroom', 'liteloader', 'legacyfabric', 'fabric-api', 'quilt-api'],
  fabric: ['forge', 'quilt', 'neoforge', 'cleanroom', 'legacyfabric', 'liteloader', 'quilt-api'],
  'fabric-api': ['forge', 'quilt', 'quilt-api', 'neoforge', 'liteloader', 'optifine', 'cleanroom', 'legacyfabric', 'legacyfabric-api'],
  quilt: ['forge', 'fabric', 'neoforge', 'cleanroom', 'legacyfabric', 'fabric-api', 'quilt-api'],
  'quilt-api': ['forge', 'fabric', 'fabric-api', 'neoforge', 'liteloader', 'optifine', 'cleanroom', 'legacyfabric', 'legacyfabric-api'],
  cleanroom: ['forge', 'fabric', 'quilt', 'neoforge', 'legacyfabric', 'liteloader', 'optifine', 'fabric-api', 'quilt-api'],
  liteloader: ['fabric', 'quilt', 'neoforge', 'cleanroom', 'legacyfabric', 'optifine', 'fabric-api', 'quilt-api'],
  'legacyfabric': ['forge', 'fabric', 'quilt', 'neoforge', 'cleanroom', 'liteloader', 'optifine', 'fabric-api', 'quilt-api'],
  'legacyfabric-api': ['forge', 'fabric', 'fabric-api', 'neoforge', 'liteloader', 'optifine', 'cleanroom', 'quilt', 'quilt-api']
};

/** Warps game version numbers so 1.13.2 > 1.12.2 etc. */
function compareGameVersions(a: string, b: string): number {
  const parts = (id: string): number[] =>
    id.split('.').map((part) => {
      const leading = /^\d+/.exec(part);
      return leading === null ? 0 : Number.parseInt(leading[0], 10);
    });
  const va = parts(a);
  const vb = parts(b);
  for (let i = 0; i < Math.max(va.length, vb.length); i += 1) {
    const diff = (va[i] ?? 0) - (vb[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

/** Which installer cards are shown for a game version (HMCL DEFAULT_INSTALLERS). */
function installersFor(gameId: string): InstallerComponentId[] {
  if (compareGameVersions(gameId, '1.12.2') === 0) {
    return ['forge', 'optifine', 'cleanroom', 'liteloader', 'legacyfabric', 'legacyfabric-api'];
  }
  if (compareGameVersions(gameId, '1.13.2') <= 0) {
    return ['forge', 'optifine', 'liteloader', 'legacyfabric', 'legacyfabric-api'];
  }
  return ['forge', 'neoforge', 'optifine', 'fabric', 'fabric-api', 'quilt', 'quilt-api'];
}

type DlTab = 'game' | 'modpack' | 'mod' | 'resourcepack' | 'shader' | 'world';
type VersionFilter = 'all' | 'release' | 'snapshots' | 'april_fools' | 'old';
type VersionKind = 'release' | 'snapshot' | 'april_fools' | 'old';

/**
 * Where a 模组/资源包/光影 gets installed: the id of the instance it is being
 * installed into, mirroring the 游戏 combo HMCL puts on the first row of its
 * download search card. `undefined` only when no instance is installed at all.
 *
 * The choice is page-local on purpose: picking a target here must not change
 * which instance the launcher launches.
 */
type AddonTarget = string | undefined;

/** Combo label for an instance, marking the ones that keep their own files. */
function addonTargetOption(instance: InstalledVersionDto): string {
  return instance.isolated ? `${instance.id}（版本隔离）` : instance.id;
}

const FILTER_LABELS: Record<VersionFilter, string> = {
  all: '全部',
  release: '正式版',
  snapshots: '快照',
  april_fools: '愚人节',
  old: '远古版'
};

const VERSION_TAG_LABELS: Record<VersionKind, string> = {
  release: '正式版',
  snapshot: '快照',
  april_fools: '愚人节',
  old: '远古版'
};

const VERSION_ICONS: Record<VersionKind, string> = {
  release: 'img/grass@2x.png',
  snapshot: 'img/command@2x.png',
  april_fools: 'img/april_fools@2x.png',
  old: 'img/craft_table@2x.png'
};

/**
 * The built-in instance icons, in `GameInstanceIconDialog`'s order.
 *
 * The ids are the contract: @hmcl/core hands the instance list an id back and
 * writes the one the user picked into the instance settings, so they have to
 * match `INSTANCE_ICON_TYPES` there. The assets are renderer-owned, like
 * `VERSION_ICONS` above — they are the `@2x` variants of HMCL's own artwork,
 * which keeps a 32px icon sharp on a HiDPI display.
 */
const INSTANCE_ICONS: ReadonlyArray<{ id: string; asset: string }> = [
  { id: 'GRASS', asset: 'img/grass@2x.png' },
  { id: 'CHEST', asset: 'img/chest@2x.png' },
  { id: 'CHICKEN', asset: 'img/chicken@2x.png' },
  { id: 'COMMAND', asset: 'img/command@2x.png' },
  { id: 'APRIL_FOOLS', asset: 'img/april_fools@2x.png' },
  { id: 'OPTIFINE', asset: 'img/optifine@2x.png' },
  { id: 'CRAFT_TABLE', asset: 'img/craft_table@2x.png' },
  { id: 'FABRIC', asset: 'img/fabric@2x.png' },
  { id: 'LEGACY_FABRIC', asset: 'img/legacyfabric@2x.png' },
  { id: 'FORGE', asset: 'img/forge@2x.png' },
  { id: 'CLEANROOM', asset: 'img/cleanroom@2x.png' },
  { id: 'NEO_FORGE', asset: 'img/neoforge@2x.png' },
  { id: 'FURNACE', asset: 'img/furnace@2x.png' },
  { id: 'QUILT', asset: 'img/quilt@2x.png' }
];

function instanceIconAsset(id: string | undefined): string {
  return INSTANCE_ICONS.find((entry) => entry.id === id)?.asset ?? 'img/grass@2x.png';
}

// Ported from GameVersionNumber#isAprilFools plus the known special ids.
const KNOWN_APRIL_FOOLS = new Set([
  '15w14a',
  '1.RV-Pre1',
  '3D Shareware v1.34',
  '20w14∞',
  '22w13oneblockatatime',
  '23w13a_or_b',
  '24w14potato',
  '25w14craftmine'
]);

const STANDARD_VERSION_PATTERN =
  /^(?:[ab]\d+[\d._a-z]*|\d+(?:\.\d+)*(?:-?pre\d*|-?rc\d+)?|\d{2}w\d{2}[a-z](?:_unobfuscated)?|c\d+[\d._a-z]*)$/i;

function isAprilFools(id: string): boolean {
  if (KNOWN_APRIL_FOOLS.has(id)) return true;
  // Non-standard "special" ids follow HMCL's rule: exotic names not starting
  // with "1." are April Fools versions.
  return !STANDARD_VERSION_PATTERN.test(id) && !id.startsWith('1.');
}

function versionKind(version: RemoteVersionDto): VersionKind {
  if (version.type === 'release') return 'release';
  if (version.type === 'snapshot') {
    return isAprilFools(version.id) ? 'april_fools' : 'snapshot';
  }
  return 'old';
}

function matchesFilter(kind: VersionKind, filter: VersionFilter): boolean {
  switch (filter) {
    case 'release':
      return kind === 'release';
    case 'snapshots':
      return kind === 'snapshot' || kind === 'april_fools';
    case 'april_fools':
      return kind === 'april_fools';
    case 'old':
      return kind === 'old';
    default:
      return true;
  }
}

function formatReleaseTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (value: number): string => String(value).padStart(2, '0');
  // datetime.format=yyyy 年 MM 月 dd 日 HH:mm:ss
  return (
    `${date.getFullYear()} 年 ${pad(date.getMonth() + 1)} 月 ${pad(date.getDate())} 日 ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

function wikiLink(version: RemoteVersionDto): string {
  const id = version.id.replace(/_unobfuscated$/, '');
  const page = /^\d{2}w\d{2}/.test(id)
    ? encodeURIComponent(id)
    : encodeURIComponent(`Java版${id}`);
  return `https://zh.minecraft.wiki/w/${page}?variant=zh-cn`;
}

type StateHookProps = { state: StateHook };

/**
 * Download page replicating HMCL's DownloadPage: an inner navigation sidebar
 * (新游戏 / 游戏内容) plus a per-category content area.
 */
function DownloadPage({
  state,
  detail,
  tab,
  onTabChange,
  addonTarget,
  onAddonTargetChange,
  onOpenDetail,
  onCloseDetail
}: {
  state: StateHook;
  detail: ModrinthProjectDto | undefined;
  /** Held by the shell so the instance list can pick a tab (showGameDownloads). */
  tab: DlTab;
  onTabChange: (tab: DlTab) => void;
  addonTarget: AddonTarget;
  onAddonTargetChange: (target: string | undefined) => void;
  onOpenDetail: (project: ModrinthProjectDto) => void;
  onCloseDetail: () => void;
}): React.JSX.Element {
  // The tab now comes from the shell, which holds it so the instance list's
  // 安装新游戏 button can select one before this page mounts.
  const setTab = onTabChange;
  const [install, setInstall] = useState<
    { project: ModrinthProjectDto; version: ModrinthVersionDto } | undefined
  >(undefined);

  const tabs: Array<{
    id: DlTab;
    label: string;
    Icon: (props: { size?: number }) => React.JSX.Element;
    FillIcon?: (props: { size?: number }) => React.JSX.Element;
  }> = [
    { id: 'game', label: '游戏', Icon: GamepadIcon, FillIcon: GamepadFillIcon },
    { id: 'modpack', label: '整合包', Icon: PackageIcon, FillIcon: PackageFillIcon },
    { id: 'mod', label: '模组', Icon: ExtensionIcon, FillIcon: ExtensionFillIcon },
    { id: 'resourcepack', label: '资源包', Icon: TextureIcon },
    { id: 'shader', label: '光影', Icon: SunnyIcon, FillIcon: SunnyFillIcon },
    { id: 'world', label: '世界', Icon: PublicIcon }
  ];

  // Original HMCL navigates to a full DownloadPage when a result row is
  // clicked (ui/instances/DownloadPage); the whole window is replaced.
  if (detail !== undefined) {
    return (
      <>
        <AddonDetailPage
          state={state}
          project={detail}
          target={addonTarget}
          onClose={onCloseDetail}
          onInstallModpack={(version) =>
            setInstall({ project: detail, version })
          }
        />
        {install !== undefined && (
          <ModpackInstallPage
            state={state}
            project={install.project}
            version={install.version}
            onClose={() => setInstall(undefined)}
          />
        )}
      </>
    );
  }

  return (
    <div className="download-page">
      <aside className="dl-sidebar">
        <div className="class-title">新游戏</div>
        {tabs.slice(0, 2).map((entry) => (
          <DlSidebarItem key={entry.id} entry={entry} active={tab === entry.id} onSelect={setTab} />
        ))}
        <div className="class-title">游戏内容</div>
        {tabs.slice(2).map((entry) => (
          <DlSidebarItem key={entry.id} entry={entry} active={tab === entry.id} onSelect={setTab} />
        ))}
      </aside>
      <main className="dl-main">
        {tab === 'game' ? (
          <GameVersionsTab state={state} />
        ) : tab === 'modpack' ? (
          <ModpackTab state={state} onOpenDetail={onOpenDetail} />
        ) : tab === 'world' ? (
          <UnsupportedCategory state={state} />
        ) : (
          <AddonTab
            state={state}
            type={tab}
            target={addonTarget}
            onTargetChange={onAddonTargetChange}
            onOpenDetail={onOpenDetail}
          />
        )}
      </main>
    </div>
  );
}

function DlSidebarItem({
  entry,
  active,
  onSelect
}: {
  entry: {
    id: DlTab;
    label: string;
    Icon: (props: { size?: number }) => React.JSX.Element;
    FillIcon?: (props: { size?: number }) => React.JSX.Element;
  };
  active: boolean;
  onSelect: (tab: DlTab) => void;
}): React.JSX.Element {
  const Graphic = active ? (entry.FillIcon ?? entry.Icon) : entry.Icon;
  return (
    <button
      className={`advanced-list-item${active ? ' selected' : ''}`}
      onClick={() => onSelect(entry.id)}
    >
      <Graphic size={20} />
      <span>{entry.label}</span>
    </button>
  );
}

// ============ Addon detail page (mirrors ui/instances/DownloadPage) ============

const ADDON_LOADER_LABELS: Record<string, string> = {
  forge: 'Forge',
  neoforge: 'NeoForge',
  fabric: 'Fabric',
  quilt: 'Quilt',
  liteloader: 'LiteLoader',
  legacyfabric: 'LegacyFabric',
  cleanroom: 'Cleanroom',
  datapack: '数据包',
  minecraft: 'Minecraft'
};

const DEPENDENCY_LABELS: Record<string, string> = {
  required: '必需依赖',
  optional: '可选依赖',
  embedded: '嵌入依赖',
  tool: '工具依赖',
  include: '包含依赖',
  incompatible: '不兼容',
  broken: '损坏'
};

/** HMCL channel names shown next to a version (addon.channel.*). */
function channelLabel(channel: string | undefined): string | undefined {
  if (channel === 'release') return '正式版';
  if (channel === 'beta') return 'Beta';
  if (channel === 'alpha') return 'Alpha';
  return undefined;
}

/** Maps ISO timestamps to the local "yyyy/MM/dd HH:mm" shape HMCL uses. */
function formatPublishedDate(date: string | undefined): string {
  if (date === undefined) return '';
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return date;
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Verbatim Modrinth project page URL for a project. */
function modrinthProjectUrl(project: ModrinthProjectDto): string {
  const segment = project.projectType === 'modpack' ? 'modpack' : project.projectType;
  return `https://modrinth.com/${segment}/${project.slug}`;
}

/** A sorted group of addon versions, mirroring HMCL's ComponentSublist groups. */
interface AddonVersionGroup {
  title: string;
  recommend: boolean;
  items: ModrinthVersionDto[];
}

/** Fallback game-version ordering: descending (1.21 > 1.20 > …). */
function compareAddonGameVersions(a: string, b: string): number {
  return compareGameVersions(b, a);
}

/** What the 「推荐」 group matches an addon version against. */
interface AddonRecommendation {
  /** Minecraft version the target instance runs. */
  gameVersion: string;
  /** Loaders detected on the target instance; empty for vanilla. */
  loaders: string[];
  /** Only mods have to match the loaders — packs and shaders list minecraft. */
  checkLoaders: boolean;
}

/**
 * Resolves the target instance into the shape the version list groups by.
 * Returns undefined when there is no target, which recommends nothing.
 */
function recommendationFor(
  target: AddonTarget,
  kind: DlAddonKind,
  installed: readonly InstalledVersionDto[]
): AddonRecommendation | undefined {
  if (target === undefined) return undefined;
  const instance = installed.find((entry) => entry.id === target);
  if (instance === undefined) return undefined;
  return {
    gameVersion: instance.gameVersion,
    loaders: instance.loaders.map((loader) => loader.slug),
    checkLoaders: kind === 'mod'
  };
}

/**
 * Whether a version is worth recommending for the target instance.
 *
 * HMCL only recommends a mod whose loaders overlap the instance's, so a
 * Fabric-only mod is not pushed at a Forge game. A vanilla instance has no
 * loader to overlap and gets no 推荐 at all, which is what HMCL does too.
 */
function isRecommendedVersion(
  version: ModrinthVersionDto,
  recommend: AddonRecommendation
): boolean {
  if (!version.gameVersions.includes(recommend.gameVersion)) return false;
  if (!recommend.checkLoaders) return true;
  return version.loaders.some((loader) => recommend.loaders.includes(loader));
}

/**
 * Groups addon versions the way HMCL's DownloadPage skin does: an optional
 * 「推荐」 list for the target instance's game version, then per-Minecraft
 * sublists with releases first and snapshots after.
 */
function buildVersionGroups(
  versions: ModrinthVersionDto[],
  remote: RemoteVersionDto[],
  recommend: AddonRecommendation | undefined
): AddonVersionGroup[] {
  const released = new Set<string>();
  const snapshots = new Set<string>();
  for (const version of remote) {
    if (version.type === 'release' || version.type === 'old_release') {
      released.add(version.id);
    } else if (version.type === 'snapshot' || version.type === 'old_beta' || version.type === 'old_alpha') {
      snapshots.add(version.id);
    }
  }

  const primaryVersionOf = (entry: ModrinthVersionDto): string | undefined =>
    entry.gameVersions.find((game) => released.has(game)) ??
    entry.gameVersions.find((game) => snapshots.has(game)) ??
    entry.gameVersions[0];

  const byDate = (a: ModrinthVersionDto, b: ModrinthVersionDto): number =>
    (b.datePublished ?? '').localeCompare(a.datePublished ?? '');

  // Versions usable on the target instance → 推荐.
  const groups: AddonVersionGroup[] = [];
  if (recommend !== undefined) {
    const recommended = versions
      .filter((entry) => isRecommendedVersion(entry, recommend))
      .sort(byDate);
    if (recommended.length > 0) {
      groups.push({
        title: `推荐版本 - Minecraft ${recommend.gameVersion}`,
        recommend: true,
        items: recommended
      });
    }
  }

  // Group the remaining versions under their release-or-snapshot family,
  // ordered newest game version first (TreeMap reverseOrder in HMCL).
  const families = new Map<string, { release: ModrinthVersionDto[]; snapshot: ModrinthVersionDto[] }>();
  const familyOrder: string[] = [];
  for (const entry of versions) {
    const gameVersion = primaryVersionOf(entry);
    if (gameVersion === undefined) continue;
    const isSnapshot = !released.has(gameVersion) && (snapshots.has(gameVersion) || gameVersion.includes('-'));
    const parent = isSnapshot && gameVersion.includes('-') ? gameVersion.slice(0, gameVersion.lastIndexOf('-')) : gameVersion;
    let family = families.get(parent);
    if (family === undefined) {
      family = { release: [], snapshot: [] };
      families.set(parent, family);
      familyOrder.push(parent);
    }
    (isSnapshot ? family.snapshot : family.release).push(entry);
  }
  familyOrder.sort(compareAddonGameVersions);

  for (const parent of familyOrder) {
    const family = families.get(parent)!;
    if (family.release.length > 0) {
      groups.push({ title: `正式版 ${parent}`, recommend: false, items: family.release.sort(byDate) });
    }
    if (family.snapshot.length > 0) {
      groups.push({ title: `快照 ${parent}`, recommend: false, items: family.snapshot.sort(byDate) });
    }
  }
  return groups;
}

/** Version row shared by the detail page and the version dialog. */
function AddonVersionRow({
  version,
  onClick
}: {
  version: ModrinthVersionDto;
  onClick?: () => void;
}): React.JSX.Element {
  const channel = channelLabel(version.versionType);
  const channelClass = version.versionType ?? 'release';
  return (
    <div className="addon-version" onClick={onClick}>
      <span className={`addon-channel-icon ${channelClass}`} aria-hidden />
      <div className="two-line">
        <div className="first-line">
          <span className="title">{version.name}</span>
          {channel !== undefined && <span className={`tag channel-tag ${channelClass}`}>{channel}</span>}
          {version.loaders
            .filter((loader) => loader !== 'minecraft')
            .map((loader) => (
              <span key={loader} className="tag">
                {ADDON_LOADER_LABELS[loader] ?? loader}
              </span>
            ))}
        </div>
        <div className="subtitle">{version.versionNumber} · {formatPublishedDate(version.datePublished)}</div>
      </div>
    </div>
  );
}

/**
 * Full addon page mirroring `ui/instances/DownloadPage`: a description card on
 * top and the version list grouped by 推荐/正式版/快照 below.
 */
function AddonDetailPage({
  state,
  project,
  target,
  onClose,
  onInstallModpack
}: {
  state: StateHook;
  project: ModrinthProjectDto;
  target: AddonTarget;
  onClose: () => void;
  onInstallModpack: (version: ModrinthVersionDto) => void;
}): React.JSX.Element {
  const [versions, setVersions] = useState<ModrinthVersionDto[] | undefined>(undefined);
  const [remote, setRemote] = useState<RemoteVersionDto[]>([]);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<ModrinthVersionDto | undefined>(undefined);
  const [categoryMap, setCategoryMap] = useState<Record<string, string>>({});

  useEffect(() => {
    let disposed = false;
    hmcl()
      .fetchModrinthVersions(project.slug)
      .then((items) => {
        if (!disposed) setVersions(items);
      })
      .catch(() => {
        if (!disposed) setFailed(true);
      });
    hmcl()
      .fetchRemoteVersions()
      .then((items) => {
        if (!disposed) setRemote(items);
      })
      .catch(() => {
        if (!disposed) setRemote([]);
      });
    hmcl()
      .fetchModrinthCategories(project.projectType)
      .then((items) => {
        const map: Record<string, string> = {};
        for (const entry of items) map[entry.slug] = localizeCategory(entry);
        if (!disposed) setCategoryMap(map);
      })
      .catch(() => {
        if (!disposed) setCategoryMap({});
      });
    return () => {
      disposed = true;
    };
  }, [project.slug, project.projectType]);

  const kind = project.projectType as DlAddonKind;
  const groups = useMemo(
    () =>
      versions === undefined
        ? []
        : // The recommendation is derived inside the memo so its identity never
          // invalidates it; the target's id is the only part that can change it.
          buildVersionGroups(versions, remote, recommendationFor(target, kind, state.installed)),
    [versions, remote, target, kind, state.installed]
  );

  return (
    <div className="addon-detail">
      {selected !== undefined && (
        <AddonVersionDialog
          state={state}
          project={project}
          version={selected}
          target={target}
          onClose={() => setSelected(undefined)}
          onInstallModpack={onInstallModpack}
        />
      )}
      <div className="card addon-detail-head">
        {project.iconUrl !== undefined ? (
          <img src={project.iconUrl} alt="" width={40} height={40} draggable={false} loading="lazy" />
        ) : (
          <span className="addon-icon-fallback">{project.title.charAt(0)}</span>
        )}
        <div className="two-line">
          <div className="first-line">
            <span className="title">{project.title}</span>
            {project.categories
              .filter((slug) => slug !== 'minecraft')
              .slice(0, 4)
              .map((slug) => (
                <span key={slug} className="tag">
                  {categoryMap[slug] ?? slug}
                </span>
              ))}
          </div>
          <div className="subtitle detail-description">{project.description}</div>
        </div>
        <button
          className="text-button"
          onClick={() => void hmcl().openExternal(modrinthProjectUrl(project))}
        >
          Modrinth
        </button>
      </div>

      <div className="addon-versions-wrap">
        {versions === undefined && !failed && (
          <div className="notice-pane">
            <span className="spinner" />
          </div>
        )}
        {failed && (
          <button className="notice-pane clickable" onClick={() => window.location.reload()}>
            [版本列表加载失败，点击刷新]
          </button>
        )}
        {versions !== undefined && versions.length === 0 && (
          <div className="notice-pane">[没有找到该{project.projectType === 'modpack' ? '整合包' : '项目'}的可用版本]</div>
        )}
        {groups.map((group) => (
          <div className="version-group" key={group.title}>
            <div className="group-title">{group.title}</div>
            <div className="card dl-list-card">
              <div className="dl-list">
                {group.items.map((entry) => (
                  <AddonVersionRow key={entry.id} version={entry} onClick={() => setSelected(entry)} />
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Electron wraps anything crossing the IPC boundary as
 * `Error invoking remote method 'channel': <reason>`. The channel name tells a
 * user nothing, and the doubled `Error:` reads like two separate problems, so
 * strip the envelope before the reason reaches the screen.
 */
function describeInstallError(reason: unknown): string {
  return String(reason)
    .replace(/^Error: Error invoking remote method '[^']*':\s*/, '')
    .replace(/^Error:\s*/, '');
}

/**
 * Version dialog mirroring `ui/instances/DownloadPage.AddonVersion`: changelog,
 * official page, dependencies and the 安装/另存为/取消 action bar.
 */
function AddonVersionDialog({
  state,
  project,
  version,
  target,
  onClose,
  onInstallModpack
}: {
  state: StateHook;
  project: ModrinthProjectDto;
  version: ModrinthVersionDto;
  target: AddonTarget;
  onClose: () => void;
  onInstallModpack: (version: ModrinthVersionDto) => void;
}): React.JSX.Element {
  const { showToast } = state;
  const isModpack = project.projectType === 'modpack';
  const primary = version.files.find((file) => file.primary) ?? version.files[0];
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState<string | undefined>(undefined);
  const kind = project.projectType as DlAddonKind;
  const kindLabel = ADDON_LABELS[kind] ?? '文件';
  const subdir = subdirForAddon(kind);
  // This dialog is a page away from the combo that picked the target, so it
  // repeats it here — otherwise the only way to tell where a pack landed is to
  // notice afterwards that it is missing from the instance you were looking at.
  // The directory is spelled out too: whether an instance keeps its files in
  // its own version folder is the one thing that decides where the file ends
  // up, and it is not visible anywhere else.
  const targetInstance = state.installed.find((entry) => entry.id === target);
  const targetLabel = target ?? '未选择实例';
  const targetDir =
    targetInstance === undefined
      ? undefined
      : targetInstance.isolated
        ? `versions/${targetInstance.id}/${subdir}/`
        : `${subdir}/`;
  const progress = state.progress;
  const percent = downloadPercent(progress);

  const installIntoTarget = async (): Promise<void> => {
    if (installing || target === undefined) return;
    setInstalling(true);
    setInstallError(undefined);
    try {
      // The dialog used to close here, before the download had even started, so
      // the "安装失败" note below was written into a component that no longer
      // existed. A failed install therefore reported nothing at all. Stay open
      // until the file has actually landed.
      await hmcl().downloadAddonFile(target, subdir, version);
      state.appendLog({
        text: `>>> ${kindLabel}安装到 ${targetLabel}：${primary?.filename ?? version.name}`,
        isError: false
      });
      showToast(`${kindLabel}已安装到 ${targetLabel}`);
      onClose();
    } catch (reason) {
      // Keep the dialog up and put the reason right where the user is looking,
      // rather than closing it and hiding everything in a closed log drawer.
      // The main process already reports this failure to the log through its
      // download-settled event, so writing it again here would only duplicate
      // the same line in a noisier form.
      setInstallError(describeInstallError(reason));
    } finally {
      setInstalling(false);
    }
  };

  const saveAs = (): void => {
    if (primary === undefined) return;
    hmcl()
      .saveAddonFile(primary.url, primary.filename)
      .then((saved) => {
        if (saved) showToast('已保存到本地');
      })
      .catch((reason: unknown) => showToast(`保存失败：${String(reason)}`));
  };

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet addon-version-dialog" onClick={(event) => event.stopPropagation()}>
        <h3 className="sheet-title">下载 {version.name}</h3>
        <div className="sheet-body">
          <AddonVersionRow version={version} />
          <div className="version-links">
            {version.changelogUrl !== undefined && version.changelogUrl !== '' && (
              <button className="text-button" onClick={() => void hmcl().openExternal(version.changelogUrl!)}>
                更新日志
              </button>
            )}
            <button className="text-button" onClick={() => void hmcl().openExternal(modrinthProjectUrl(project))}>
              官方页面
            </button>
          </div>
          {version.dependencies.length > 0 && (
            <div className="dependencies">
              <div className="dependencies-title">依赖</div>
              {version.dependencies.map((dependency, index) => (
                <div className="dependency-row" key={`${dependency.projectId}-${index}`}>
                  <span className="tag dep-type">{DEPENDENCY_LABELS[dependency.dependencyType] ?? dependency.dependencyType}</span>
                  <span className="dep-name">
                    {dependency.projectId === 'minecraft'
                      ? 'Minecraft'
                      : ADDON_LOADER_LABELS[dependency.projectId] ?? dependency.projectId}
                  </span>
                </div>
              ))}
            </div>
          )}
          {!isModpack && (
            <div className="install-target">
              <span className="install-target-label">安装到</span>
              <span className="install-target-value">
                {targetLabel}
                {targetDir !== undefined && <span className="install-target-dir">{targetDir}</span>}
              </span>
            </div>
          )}
        </div>
        {installing && (
          <div className="install-status">
            {percent === undefined ? (
              <div className="install-status-line">
                <span className="spinner" />
                正在安装{kindLabel}到 {targetLabel}…
              </div>
            ) : (
              <>
                <div className="install-status-line">
                  正在下载{kindLabel}到 {targetLabel}
                  <span className="install-status-percent">{percent}%</span>
                </div>
                <div className="install-bar">
                  <div className="install-bar-fill" style={{ width: `${percent}%` }} />
                </div>
                <div className="install-status-meta">
                  {progress?.totalBytes !== undefined && progress.totalBytes > 0
                    ? `${formatBytes(progress.downloadedBytes)} / ${formatBytes(progress.totalBytes)}`
                    : undefined}
                  {progress?.bytesPerSecond !== undefined && progress.bytesPerSecond > 0 && (
                    <span>{formatSpeed(progress.bytesPerSecond)}</span>
                  )}
                </div>
              </>
            )}
          </div>
        )}
        {installError !== undefined && (
          <div className="field-error install-error">
            {kindLabel}安装失败：{installError}
            <button className="text-button install-error-log" onClick={() => void hmcl().openLogWindow()}>
              查看日志
            </button>
          </div>
        )}
        <div className="sheet-actions">
          {isModpack ? (
            <button
              className="raised-button"
              onClick={() => {
                onClose();
                onInstallModpack(version);
              }}
            >
              安装整合包
            </button>
          ) : (
            <button
              className="raised-button"
              onClick={() => void installIntoTarget()}
              disabled={installing || target === undefined}
            >
              安装
            </button>
          )}
          <button className="raised-button" onClick={saveAs} disabled={primary === undefined || installing}>
            另存为
          </button>
          <button className="text-button" onClick={onClose} disabled={installing}>
            取消
          </button>
        </div>
      </div>
    </div>
  );
}

/** Versions list replicating HMCL's VersionsPage for the game category. */
function GameVersionsTab({ state }: StateHookProps): React.JSX.Element {
  const [versions, setVersions] = useState<RemoteVersionDto[] | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<VersionFilter>('release');
  const [sheetVersion, setSheetVersion] = useState<RemoteVersionDto | undefined>(undefined);

  const load = useCallback(async (): Promise<void> => {
    setVersions(undefined);
    setFailed(false);
    try {
      setVersions(await hmcl().fetchRemoteVersions());
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    let result = (versions ?? []).map((version) => ({ version, kind: versionKind(version) }));
    if (filter !== 'all') result = result.filter((entry) => matchesFilter(entry.kind, filter));
    const trimmed = query.trim();
    if (trimmed !== '') {
      if (trimmed.startsWith('regex:')) {
        try {
          const pattern = new RegExp(trimmed.slice('regex:'.length), 'i');
          result = result.filter((entry) => pattern.test(entry.version.id));
        } catch {
          // Invalid regular expressions keep the list unfiltered, like HMCL.
        }
      } else {
        const lower = trimmed.toLowerCase();
        result = result.filter((entry) => entry.version.id.toLowerCase().includes(lower));
      }
    }
    return result;
  }, [versions, filter, query]);

  return (
    <>
      <div className="search-card card">
        <div className="search-row">
          <label className="search-field">
            <span>名称</span>
            <input
              value={query}
              placeholder="输入版本名称进行搜索"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <label className="search-field">
            <span>版本类型</span>
            <select value={filter} onChange={(event) => setFilter(event.target.value as VersionFilter)}>
              {(Object.keys(FILTER_LABELS) as VersionFilter[]).map((value) => (
                <option key={value} value={value}>
                  {FILTER_LABELS[value]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="search-actions">
          <span className="search-actions-spacer" />
          <button className="raised-button" onClick={() => void load()}>
            刷新
          </button>
        </div>
      </div>

      <div className="dl-list-wrap">
        {versions === undefined && !failed && (
          <div className="notice-pane">
            <span className="spinner" />
          </div>
        )}
        {failed && (
          <button className="notice-pane clickable" onClick={() => void load()}>
            [加载数据失败，点击此处重试]
          </button>
        )}
        {versions !== undefined && versions.length === 0 && (
          <div className="notice-pane">[没有可供安装的版本]</div>
        )}
        {versions !== undefined && versions.length > 0 && (
          <div className="card dl-list-card">
            <div className="dl-list">
              {filtered.map(({ version, kind }) => (
                <div
                  key={version.id}
                  className="md-list-cell"
                  onClick={() => setSheetVersion(version)}
                >
                  <img src={VERSION_ICONS[kind]} alt="" width={32} height={32} draggable={false} />
                  <div className="two-line">
                    <div className="first-line">
                      <span className="title">{version.id}</span>
                      <span className="tag">{VERSION_TAG_LABELS[kind]}</span>
                    </div>
                    <div className="subtitle">{formatReleaseTime(version.releaseTime)}</div>
                  </div>
                  <div className="actions">
                    <button
                      className="icon-button"
                      title="Minecraft Wiki 页面"
                      onClick={(event) => {
                        event.stopPropagation();
                        void hmcl().openExternal(wikiLink(version));
                      }}
                    >
                      <WikiIcon size={18} />
                    </button>
                    <button className="icon-button" title="安装" onClick={() => setSheetVersion(version)}>
                      <ArrowForwardIcon size={18} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {sheetVersion !== undefined && (
        <InstallSheet version={sheetVersion} state={state} onClose={() => setSheetVersion(undefined)} />
      )}
    </>
  );
}

interface LoaderListState {
  items?: LoaderVersionDto[];
  failed?: boolean;
}

/** Version lists for a loader- or Modrinth-backed installer card. */
type InstallerVersionList =
  | { kind: 'loading' }
  | { kind: 'failed' }
  | { kind: 'loader'; items: LoaderVersionDto[] }
  | { kind: 'modrinth'; items: ModrinthVersionDto[] };

type ApiComponentId = 'fabric-api' | 'quilt-api' | 'legacyfabric-api';

const API_COMPONENT_IDS: ApiComponentId[] = ['fabric-api', 'quilt-api', 'legacyfabric-api'];

type InstallerResolvedState =
  | { kind: 'installed'; label: string }
  | { kind: 'incompatible'; label: string }
  | { kind: 'not-installable' }
  | { kind: 'requires-loader'; label: string }
  | { kind: 'installable' };

const isApi = (id: InstallerComponentId): id is ApiComponentId =>
  (API_COMPONENT_IDS as InstallerComponentId[]).includes(id);

/** Installer sheet replicating HMCL's InstallersPage: name card + card grid. */
function InstallSheet({
  version,
  state,
  onClose
}: {
  version: RemoteVersionDto;
  state: StateHook;
  onClose: () => void;
}): React.JSX.Element {
  const gameId = version.id;
  const ids = useMemo(() => installersFor(gameId), [gameId]);
  const [lists, setLists] = useState<Partial<Record<InstallerComponentId, InstallerVersionList>>>({});
  const [selectedLoader, setSelectedLoader] = useState<Partial<Record<LoaderKind, string>>>({});
  const [selectedApi, setSelectedApi] = useState<Partial<Record<ApiComponentId, ModrinthVersionDto>>>({});
  const [name, setName] = useState(gameId);
  const [nameEdited, setNameEdited] = useState(false);
  const [nameInvalid, setNameInvalid] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let disposed = false;
    for (const id of ids) {
      if (!INSTALLER_COMPONENTS[id].supported) continue;
      const setList = (entry: InstallerVersionList): void => {
        if (!disposed) setLists((prev) => ({ ...prev, [id]: entry }));
      };
      if (id === 'forge' || id === 'neoforge' || id === 'fabric' || id === 'optifine') {
        hmcl()
          .fetchLoaderVersions(id, gameId)
          .then((items) => setList({ kind: 'loader', items }))
          .catch(() => setList({ kind: 'failed' }));
      } else if (id === 'fabric-api' || id === 'quilt-api') {
        const slug = id === 'fabric-api' ? 'fabric-api' : 'qsl';
        const loader = id === 'fabric-api' ? 'fabric' : 'quilt';
        hmcl()
          .fetchModrinthVersions(slug)
          .then((versions) => {
            const items = versions
              .filter(
                (entry) =>
                  entry.gameVersions.includes(gameId) && entry.loaders.includes(loader)
              )
              .slice(0, 8);
            setList({ kind: 'modrinth', items });
          })
          .catch(() => setList({ kind: 'failed' }));
      }
    }
    return () => {
      disposed = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId]);

  useEffect(() => {
    if (nameEdited) return;
    // HMCL auto-builds the instance name from the chosen loader components.
    const parts: string[] = [];
    for (const id of ids) {
      const meta = INSTALLER_COMPONENTS[id];
      if (meta.simplified !== null && selectedLoader[id as LoaderKind] !== undefined) {
        parts.push(meta.simplified);
      }
    }
    setName([gameId, ...parts].join('-'));
  }, [selectedLoader, ids, gameId, nameEdited]);

  const selectedLabelOf = (id: InstallerComponentId): string | undefined => {
    if (isApi(id)) return selectedApi[id]?.versionNumber;
    return selectedLoader[id as LoaderKind];
  };

  const loaderSelected = (loader: InstallerComponentId): boolean =>
    !isApi(loader) && selectedLoader[loader as LoaderKind] !== undefined;

  const resolved = (id: InstallerComponentId): InstallerResolvedState => {
    const installed = selectedLabelOf(id);
    if (installed !== undefined) return { kind: 'installed', label: installed };
    const meta = INSTALLER_COMPONENTS[id];
    if (!meta.supported) return { kind: 'not-installable' };
    for (const other of INSTALLER_INCOMPATIBLE[id]) {
      if (selectedLabelOf(other) !== undefined) {
        return { kind: 'incompatible', label: INSTALLER_COMPONENTS[other].label };
      }
    }
    if (meta.apiOf !== undefined && !loaderSelected(meta.apiOf)) {
      return { kind: 'requires-loader', label: INSTALLER_COMPONENTS[meta.apiOf].label };
    }
    return { kind: 'installable' };
  };

  const remove = (id: InstallerComponentId): void => {
    if (isApi(id)) {
      setSelectedApi((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    } else {
      setSelectedLoader((prev) => {
        const next = { ...prev };
        delete next[id as LoaderKind];
        return next;
      });
    }
  };

  const pick = (id: InstallerComponentId, value: string): void => {
    if (value === '') {
      remove(id);
      return;
    }
    if (!isApi(id)) {
      setSelectedLoader((prev) => ({ ...prev, [id as LoaderKind]: value }));
      return;
    }
    const list = lists[id];
    if (list?.kind !== 'modrinth') return;
    const entry = list.items.find((item) => item.id === value);
    if (entry !== undefined) setSelectedApi((prev) => ({ ...prev, [id]: entry }));
  };

  const install = async (): Promise<void> => {
    if (!/^[0-9A-Za-z._-]+$/.test(name)) {
      setNameInvalid(true);
      return;
    }
    setNameInvalid(false);
    const chosenMains = ids.filter(
      (id): id is 'forge' | 'neoforge' | 'fabric' | 'optifine' =>
        !isApi(id) && INSTALLER_COMPONENTS[id].supported
    );
    const chosenApis = ids.filter(
      (id): id is ApiComponentId => isApi(id) && selectedApi[id] !== undefined
    );
    if (chosenMains.length > 1) {
      state.appendLog({ text: '安装程序暂不支持同时安装多个加载器，请只选择一个。', isError: true });
      return;
    }
    for (const id of chosenApis) {
      const loader = INSTALLER_COMPONENTS[id].apiOf;
      if (loader !== undefined && !loaderSelected(loader)) {
        state.appendLog({
          text: `安装「${INSTALLER_COMPONENTS[id].label}」需要先安装 ${INSTALLER_COMPONENTS[loader].label}。`,
          isError: true
        });
        return;
      }
    }
    setBusy(true);
    try {
      let finalId = gameId;
      if (chosenMains.length === 0) {
        await hmcl().installVersion(gameId);
      } else {
        const kind = chosenMains[0]!;
        finalId = await hmcl().installLoader(kind, gameId, selectedLoader[kind] as string);
      }
      for (const id of chosenApis) {
        await hmcl().downloadAddonFile(finalId, 'mods', selectedApi[id] as ModrinthVersionDto);
      }
      await state.refreshInstalled();
      state.setCurrentId(finalId);
      state.appendLog({ text: `>>> 安装完成：${finalId}`, isError: false });
      onClose();
    } catch (reason) {
      state.appendLog({ text: String(reason), isError: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sheet-backdrop installer-sheet-backdrop" onClick={busy ? undefined : onClose}>
      <div className="installer-sheet card" onClick={(event) => event.stopPropagation()}>
        <h3 className="sheet-title">安装新游戏 — {gameId}</h3>
        <div className="installer-name-card card-non-transparent">
          <label className="search-field installer-game-name">
            <span>游戏名</span>
            <input
              value={name}
              disabled={busy}
              onChange={(event) => {
                setNameEdited(true);
                setName(event.target.value);
              }}
            />
          </label>
          {nameInvalid && <em className="field-error">名称只能包含字母、数字、. _ -</em>}
          <button
            className="icon-button"
            title="清空"
            disabled={busy}
            onClick={() => {
              setNameEdited(true);
              setName('');
            }}
          >
            <CloseIcon size={16} />
          </button>
          <button
            className="icon-button"
            title="重置"
            disabled={busy}
            onClick={() => {
              setNameEdited(false);
              setName(gameId);
            }}
          >
            <RestoreIcon size={16} />
          </button>
        </div>

        <div className="installer-grid">
          {ids.map((id) => {
            const meta = INSTALLER_COMPONENTS[id];
            const list = lists[id];
            const st = resolved(id);
            const installed = selectedLabelOf(id) !== undefined;
            let emptyLabel = '不安装';
            if (!meta.supported) emptyLabel = '不可安装';
            else if (list === undefined || list.kind === 'loading') emptyLabel = '加载中…';
            else if (list.kind === 'failed') emptyLabel = '获取失败';
            else if (list.kind === 'modrinth' && list.items.length === 0) emptyLabel = '无可选版本';
            const statusText =
              st.kind === 'installed'
                ? st.label
                : st.kind === 'incompatible'
                  ? `与「${st.label}」不兼容`
                  : st.kind === 'not-installable'
                    ? '不可安装'
                    : st.kind === 'requires-loader'
                      ? `需要安装${st.label}`
                      : '不安装';
            const selectValue = isApi(id)
              ? (selectedApi[id]?.id ?? '')
              : (selectedLoader[id as LoaderKind] ?? '');
            const hasOptions =
              list !== undefined &&
              ((list.kind === 'loader' && list.items.length > 0) ||
                (list.kind === 'modrinth' && list.items.length > 0));
            const selectDisabled =
              busy ||
              !hasOptions ||
              (st.kind !== 'installable' && st.kind !== 'installed');
            return (
              <div className="installer-item-wrapper" key={id}>
                <div className="installer-item card">
                  <div className="installer-item-head">
                    <span className="installer-item-icon" title={meta.description}>
                      {meta.label.charAt(0)}
                    </span>
                    <div className="installer-item-lines">
                      <span className="installer-item-title">{meta.label}</span>
                      <span className="installer-item-status">{statusText}</span>
                    </div>
                  </div>
                  <select
                    className="installer-item-version"
                    value={selectValue}
                    disabled={selectDisabled}
                    onChange={(event) => pick(id, event.target.value)}
                  >
                    <option value="">{emptyLabel}</option>
                    {list?.kind === 'loader' &&
                      list.items.map((entry) => (
                        <option key={entry.id} value={entry.id}>
                          {entry.label}
                        </option>
                      ))}
                    {list?.kind === 'modrinth' &&
                      list.items.map((entry) => (
                        <option key={entry.id} value={entry.id}>
                          {entry.versionNumber}
                          {!entry.gameVersions.includes(gameId) ? ' (dev)' : ''}
                        </option>
                      ))}
                  </select>
                  {installed && (
                    <button className="text-button installer-item-remove" onClick={() => remove(id)}>
                      移除
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="sheet-actions">
          <button className="text-button" disabled={busy} onClick={onClose}>
            取消
          </button>
          <button className="raised-button" disabled={busy} onClick={() => void install()}>
            {busy ? '安装中…' : '安装'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ----- Addon (模组/资源包/光影) browsing via Modrinth -----

type DlAddonKind = 'mod' | 'resourcepack' | 'shader';

const ADDON_LABELS: Record<DlAddonKind, string> = {
  mod: '模组',
  resourcepack: '资源包',
  shader: '光影'
};

/** Search results per page, mirroring the original 50/page slider down to 20. */
const PAGE_SIZE = 20;

/** 排序 options matching the original `curse.sort.*` list. */
const SORT_OPTIONS: readonly { value: ModrinthSearchIndex; label: string }[] = [
  { value: 'relevance', label: '综合' },
  { value: 'newest', label: '最新发布' },
  { value: 'updated', label: '最近更新' },
  { value: 'downloads', label: '最多下载' }
];

function subdirForAddon(kind: DlAddonKind): 'mods' | 'resourcepacks' | 'shaderpacks' {
  if (kind === 'resourcepack') return 'resourcepacks';
  if (kind === 'shader') return 'shaderpacks';
  return 'mods';
}

/** Maps a download-page addon kind to its Modrinth project type. */
function typeToProjectType(kind: DlAddonKind): ModrinthProjectType {
  return kind;
}

/** Best-effort translations for common Modrinth category slugs, matching HMCL's i18n keys. */
const CATEGORY_LABELS: Readonly<Record<string, string>> = {
  adventure: '冒险',
  technology: '科技',
  magic: '魔法',
  decoration: '装饰',
  food: '食物',
  redstone: '红石',
  building: '建筑',
  gamemode: '玩法',
  storage: '存储',
  utility: '工具',
  management: '管理',
  mobs: '生物',
  social: '社交',
  equipment: '装备',
  optimization: '优化',
  fabric: 'Fabric',
  quilt: 'Quilt',
  forge: 'Forge',
  neoforge: 'NeoForge',
  modloader: '模组加载器',
  worldgen: '世界生成',
  'game-mechanics': '玩法机制',
  library: '库',
  misc: '其他',
  cursed: '恶搞',
  '16x': '16x',
  '32x': '32x',
  '64x': '64x',
  '128x': '128x',
  '256x': '256x',
  '512x': '512x',
  realistic: '写实',
  modern: '现代',
  rpg: 'RPG',
  anime: '动漫',
  theme: '主题',
  faithful: '忠实原版',
  dark: '暗色',
  light: '亮色',
  snowy: '雪景',
  circus: '马戏团',
  tree: '树木',
  comic: '漫画'
};

/** Displays a Modrinth category using the local translation when known. */
function localizeCategory(category: { slug: string; name: string }): string {
  return CATEGORY_LABELS[category.slug] ?? category.name;
}

/** The instance row of the search card, mirroring HMCL's own combo. */
function AddonTargetRow({
  target,
  onTargetChange,
  instances
}: {
  target: AddonTarget;
  onTargetChange: (target: string) => void;
  instances: readonly InstalledVersionDto[];
}): React.JSX.Element {
  return (
    <div className="search-row">
      <label className="search-field">
        <span>游戏</span>
        <select
          value={target ?? ''}
          disabled={instances.length === 0}
          onChange={(event) => onTargetChange(event.target.value)}
        >
          {instances.length === 0 && <option value="">没有已安装的实例</option>}
          {instances.map((instance) => (
            <option key={instance.id} value={instance.id}>
              {addonTargetOption(instance)}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

/** The HMCL-style search card: an instance row, two field rows plus a pager. */
function AddonSearchCard({
  query,
  onQueryChange,
  gameVersion,
  onGameVersionChange,
  gameVersions,
  category,
  onCategoryChange,
  categories,
  order,
  onOrderChange,
  offset,
  totalPages,
  atFirst,
  atLast,
  onPage,
  actions,
  target
}: {
  query: string;
  onQueryChange: (value: string) => void;
  gameVersion: string;
  onGameVersionChange: (value: string) => void;
  gameVersions: readonly string[];
  category: string;
  onCategoryChange: (value: string) => void;
  categories: readonly ModrinthCategoryDto[];
  order: ModrinthSearchIndex;
  onOrderChange: (value: ModrinthSearchIndex) => void;
  offset: number;
  totalPages: number;
  atFirst: boolean;
  atLast: boolean;
  onPage: (offset: number) => void;
  actions?: React.ReactNode;
  /** Omitted on 整合包, which always creates a new instance instead. */
  target?: {
    value: AddonTarget;
    onChange: (target: string) => void;
    instances: readonly InstalledVersionDto[];
  };
}): React.JSX.Element {
  // HMCL uses a static list of GA releases (GameVersionNumber.getDefaultGameVersions)
  // We approximate by filtering remote versions to releases only
  const defaultGameVersions = gameVersions.filter(v => /^\d+(\.\d+){1,2}$/.test(v));

  return (
    <div className="search-card card">
      {target !== undefined && (
        <AddonTargetRow
          target={target.value}
          onTargetChange={target.onChange}
          instances={target.instances}
        />
      )}
      <div className="search-row">
        <label className="search-field">
          <span>名称</span>
          <input
            value={query}
            placeholder="名称搜索"
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') onPage(0);
            }}
          />
        </label>
        {/* With a target instance the game version is already decided, so HMCL
            drops the filter entirely rather than leaving a stale one applied. */}
        {target?.value === undefined && (
          <label className="search-field">
            <span>游戏版本</span>
            <select
              value={gameVersion}
              onChange={(event) => {
                onGameVersionChange(event.target.value);
                onPage(0);
              }}
            >
              <option value="">全部版本</option>
              {defaultGameVersions.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div className="search-row">
        <label className="search-field">
          <span>分类</span>
          <select
            value={category}
            onChange={(event) => {
              onCategoryChange(event.target.value);
              onPage(0);
            }}
          >
            <option value="">全部</option>
            {categories.map((entry) => (
              <option key={entry.slug} value={entry.slug}>
                {localizeCategory(entry)}
              </option>
            ))}
          </select>
        </label>
        <label className="search-field">
          <span>排序</span>
          <select
            value={order}
            onChange={(event) => {
              onOrderChange(event.target.value as ModrinthSearchIndex);
              onPage(0);
            }}
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="search-actions">
        <button className="border-button" disabled={atFirst} onClick={() => onPage(0)}>
          首页
        </button>
        <button
          className="border-button"
          disabled={atFirst}
          onClick={() => onPage(Math.max(0, offset - PAGE_SIZE))}
        >
          上一页
        </button>
        <span className="pager-label">
          第 {Math.floor(offset / PAGE_SIZE) + 1} / {totalPages} 页
        </span>
        <button
          className="border-button"
          disabled={atLast}
          onClick={() => onPage(Math.min((totalPages - 1) * PAGE_SIZE, offset + PAGE_SIZE))}
        >
          下一页
        </button>
        <button
          className="border-button"
          disabled={atLast}
          onClick={() => onPage((totalPages - 1) * PAGE_SIZE)}
        >
          末页
        </button>
        <span className="search-actions-spacer" />
        {actions}
        <button className="raised-button" onClick={() => onPage(0)}>
          搜索
        </button>
      </div>
    </div>
  );
}

/** Modrinth-backed project list for an addon category (模组/资源包/光影). */
function AddonTab({
  state,
  type,
  target,
  onTargetChange,
  onOpenDetail
}: {
  state: StateHook;
  type: DlAddonKind;
  target: AddonTarget;
  onTargetChange: (target: string) => void;
  onOpenDetail: (project: ModrinthProjectDto) => void;
}): React.JSX.Element {
  const [result, setResult] = useState<ModrinthSearchResultDto | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState('');
  const [gameVersion, setGameVersion] = useState('');
  const [category, setCategory] = useState('');
  const [order, setOrder] = useState<ModrinthSearchIndex>('relevance');
  const [offset, setOffset] = useState(0);

  // The 游戏版本 dropdown lists installed versions and remote releases, so it
  // stays useful even before any instance exists — like HMCL's version list.
  const [remoteVersions, setRemoteVersions] = useState<string[] | undefined>(undefined);
  useEffect(() => {
    let disposed = false;
    hmcl()
      .fetchRemoteVersions()
      .then((items) => {
        if (!disposed) {
          const releases = items
            .filter((item) => versionKind(item) === 'release')
            .map((item) => item.id);
          setRemoteVersions(releases);
        }
      })
      .catch(() => {
        if (!disposed) setRemoteVersions([]);
      });
    return () => {
      disposed = true;
    };
  }, []);

  const gameVersions = useMemo(() => {
    const seen = new Set<string>((remoteVersions ?? []).filter((id) => /^\d+(\.\d+){1,2}$/.test(id)));
    for (const installed of state.installed) {
      if (/^\d+(\.\d+){1,2}$/.test(installed.id)) seen.add(installed.id);
    }
    return [...seen].sort(compareGameVersions);
  }, [remoteVersions, state.installed]);

  const [categories, setCategories] = useState<ModrinthCategoryDto[]>([]);
  useEffect(() => {
    let disposed = false;
    hmcl()
      .fetchModrinthCategories(typeToProjectType(type))
      .then((items) => {
        if (!disposed) {
          setCategories([...items].sort((a, b) => localizeCategory(a).localeCompare(localizeCategory(b))));
        }
      })
      .catch(() => {
        if (!disposed) setCategories([]);
      });
    return () => {
      disposed = true;
    };
  }, [type]);

  const load = useCallback(
    async (nextOffset: number): Promise<void> => {
      setResult(undefined);
      setFailed(false);
      try {
        const payload: {
          type: ModrinthProjectType;
          query?: string;
          gameVersion?: string;
          categories?: string[];
          index?: ModrinthSearchIndex;
          offset?: number;
          limit?: number;
        } = { type: typeToProjectType(type), index: order, offset: nextOffset, limit: PAGE_SIZE };
        const trimmed = query.trim();
        if (trimmed !== '') payload.query = trimmed;
        // The card hides 游戏版本 once an instance is the target, so a filter
        // left over from before must not silently narrow the results.
        if (gameVersion !== '' && target === undefined) payload.gameVersion = gameVersion;
        if (category !== '') payload.categories = [category];
        const page = await hmcl().searchModrinthProjects(payload);
        setOffset(nextOffset);
        setResult(page);
      } catch {
        setFailed(true);
      }
    },
    [type, query, gameVersion, category, order, target]
  );

  useEffect(() => {
    void load(0);
  }, [load]);

  const totalPages = result === undefined ? 1 : Math.max(1, Math.ceil(result.totalHits / PAGE_SIZE));
  const atFirst = result === undefined || offset === 0;
  const atLast = result === undefined || offset + PAGE_SIZE >= result.totalHits;

  return (
    <>
      <AddonSearchCard
        query={query}
        onQueryChange={setQuery}
        gameVersion={gameVersion}
        onGameVersionChange={setGameVersion}
        gameVersions={gameVersions}
        category={category}
        onCategoryChange={setCategory}
        categories={categories}
        order={order}
        onOrderChange={setOrder}
        offset={offset}
        totalPages={totalPages}
        atFirst={atFirst}
        atLast={atLast}
        onPage={(next) => void load(next)}
        target={{ value: target, onChange: onTargetChange, instances: state.installed }}
      />

      <div className="dl-list-wrap">
        {result === undefined && !failed && (
          <div className="notice-pane">
            <span className="spinner" />
          </div>
        )}
        {failed && (
          <button className="notice-pane clickable" onClick={() => void load(offset)}>
            [加载数据失败，点击此处重试]
          </button>
        )}
        {result !== undefined && !failed && result.projects.length === 0 && (
          <div className="notice-pane">[没有找到相关的{ADDON_LABELS[type]}]</div>
        )}
        {result !== undefined && !failed && result.projects.length > 0 && (
          <div className="card dl-list-card">
            <div className="dl-list">
              {result.projects.map((project) => (
                <div key={project.slug} className="md-list-cell" onClick={() => onOpenDetail(project)}>
                  {project.iconUrl !== undefined ? (
                    <img
                      src={project.iconUrl}
                      alt=""
                      width={40}
                      height={40}
                      draggable={false}
                      loading="lazy"
                    />
                  ) : (
                    <span className="addon-icon-fallback">{project.title.charAt(0)}</span>
                  )}
                  <div className="two-line">
                    <div className="first-line">
                      <span className="title">{project.title}</span>
                      {project.categories
                        .filter((slug) => slug !== 'minecraft')
                        .slice(0, 3)
                        .map((slug) => {
                          const entry = categories.find((category) => category.slug === slug);
                          return (
                            <span key={slug} className="tag">
                              {entry !== undefined ? localizeCategory(entry) : slug}
                            </span>
                          );
                        })}
                    </div>
                    <div className="subtitle">{project.description}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

// ----- 整合包 browsing + local import -----

/** Makes a string safe to use as an instance id. */
function sanitizeInstanceName(input: string): string {
  const cleaned = input.replace(/[^\w.-]+/g, '');
  return cleaned === '' ? '安装整合包' : cleaned;
}

/** Derives an instance name suggestion from a local modpack file path. */
function instanceNameFromPath(path: string): string {
  const fileName = path.split(/[\\/]/).pop() ?? '安装整合包';
  return sanitizeInstanceName(fileName.replace(/\.[^.]+$/, ''));
}

/** Modrinth modpack list plus local-file import entry point. */
function ModpackTab({
  state,
  onOpenDetail
}: {
  state: StateHook;
  onOpenDetail: (project: ModrinthProjectDto) => void;
}): React.JSX.Element {
  const [result, setResult] = useState<ModrinthSearchResultDto | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState('');
  const [gameVersion, setGameVersion] = useState('');
  const [category, setCategory] = useState('');
  const [categories, setCategories] = useState<ModrinthCategoryDto[]>([]);
  const [order, setOrder] = useState<ModrinthSearchIndex>('relevance');
  const [offset, setOffset] = useState(0);
  const [installLocal, setInstallLocal] = useState<string | undefined>(undefined);

  // The 游戏版本 dropdown lists installed versions and remote releases, so it
  // stays useful even before any instance exists — like HMCL's static
  // `GameVersionNumber.getDefaultGameVersions()` list.
  const [remoteVersions, setRemoteVersions] = useState<string[] | undefined>(undefined);
  useEffect(() => {
    let disposed = false;
    hmcl()
      .fetchRemoteVersions()
      .then((items) => {
        if (!disposed) {
          const releases = items
            .filter((item) => versionKind(item) === 'release')
            .map((item) => item.id);
          setRemoteVersions(releases);
        }
      })
      .catch(() => {
        if (!disposed) setRemoteVersions([]);
      });
    return () => {
      disposed = true;
    };
  }, []);

  const gameVersions = useMemo(() => {
    const seen = new Set<string>((remoteVersions ?? []).filter((id) => /^\d+(\.\d+){1,2}$/.test(id)));
    for (const installed of state.installed) {
      if (/^\d+(\.\d+){1,2}$/.test(installed.id)) seen.add(installed.id);
    }
    return [...seen].sort(compareGameVersions);
  }, [remoteVersions, state.installed]);

  useEffect(() => {
    let disposed = false;
    hmcl()
      .fetchModrinthCategories('modpack')
      .then((items) => {
        if (!disposed) {
          setCategories([...items].sort((a, b) => localizeCategory(a).localeCompare(localizeCategory(b))));
        }
      })
      .catch(() => {
        if (!disposed) setCategories([]);
      });
    return () => {
      disposed = true;
    };
  }, []);

  const load = useCallback(
    async (nextOffset: number): Promise<void> => {
      setResult(undefined);
      setFailed(false);
      try {
        const payload: {
          type: ModrinthProjectType;
          query?: string;
          gameVersion?: string;
          categories?: string[];
          index?: ModrinthSearchIndex;
          offset?: number;
          limit?: number;
        } = { type: 'modpack', index: order, offset: nextOffset, limit: PAGE_SIZE };
        const trimmed = query.trim();
        if (trimmed !== '') payload.query = trimmed;
        if (gameVersion !== '') payload.gameVersion = gameVersion;
        if (category !== '') payload.categories = [category];
        const page = await hmcl().searchModrinthProjects(payload);
        setOffset(nextOffset);
        setResult(page);
      } catch {
        setFailed(true);
      }
    },
    [query, gameVersion, category, order]
  );

  useEffect(() => {
    void load(0);
  }, [load]);

  const totalPages = result === undefined ? 1 : Math.max(1, Math.ceil(result.totalHits / PAGE_SIZE));
  const atFirst = result === undefined || offset === 0;
  const atLast = result === undefined || offset + PAGE_SIZE >= result.totalHits;

  const pickImport = async (): Promise<void> => {
    try {
      const file = await hmcl().pickModpackFile();
      if (file !== undefined) setInstallLocal(file);
    } catch (reason) {
      state.appendLog({ text: String(reason), isError: true });
    }
  };

  return (
    <>
      <AddonSearchCard
        query={query}
        onQueryChange={setQuery}
        gameVersion={gameVersion}
        onGameVersionChange={setGameVersion}
        gameVersions={gameVersions}
        category={category}
        onCategoryChange={setCategory}
        categories={categories}
        order={order}
        onOrderChange={setOrder}
        offset={offset}
        totalPages={totalPages}
        atFirst={atFirst}
        atLast={atLast}
        onPage={(next) => void load(next)}
        actions={
          <button className="border-button" onClick={() => void pickImport()}>
            安装整合包
          </button>
        }
      />

      <div className="dl-list-wrap">
        {result === undefined && !failed && (
          <div className="notice-pane">
            <span className="spinner" />
          </div>
        )}
        {failed && (
          <button className="notice-pane clickable" onClick={() => void load(offset)}>
            [加载数据失败，点击此处重试]
          </button>
        )}
        {result !== undefined && !failed && result.projects.length === 0 && (
          <div className="notice-pane">[没有找到相关的整合包]</div>
        )}
        {result !== undefined && !failed && result.projects.length > 0 && (
          <div className="card dl-list-card">
            <div className="dl-list">
              {result.projects.map((project) => (
                <div key={project.slug} className="md-list-cell" onClick={() => onOpenDetail(project)}>
                  {project.iconUrl !== undefined ? (
                    <img
                      src={project.iconUrl}
                      alt=""
                      width={40}
                      height={40}
                      draggable={false}
                      loading="lazy"
                    />
                  ) : (
                    <span className="addon-icon-fallback">{project.title.charAt(0)}</span>
                  )}
                  <div className="two-line">
                    <div className="first-line">
                      <span className="title">{project.title}</span>
                      {project.categories
                        .filter((slug) => slug !== 'minecraft')
                        .slice(0, 3)
                        .map((slug) => {
                          const entry = categories.find((category) => category.slug === slug);
                          return (
                            <span key={slug} className="tag">
                              {entry !== undefined ? localizeCategory(entry) : slug}
                            </span>
                          );
                        })}
                    </div>
                    <div className="subtitle">{project.description}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {installLocal !== undefined && (
        <ModpackInstallPage
          state={state}
          localPath={installLocal}
          onClose={() => setInstallLocal(undefined)}
        />
      )}
    </>
  );
}

/**
 * Full-page modpack install wizard mirroring HMCL (LocalModpackPage layout):
 * the chosen instance name, pack metadata rows, then a large progress area
 * showing percent, 第 N/M 个文件, the current file and the transfer speed.
 * Works for both a Modrinth version (`project` + `version`) and a local file
 * (`localPath`). Rendered as a fixed overlay so it covers the whole window.
 */
function ModpackInstallPage({
  state,
  project,
  version,
  localPath,
  initialName,
  origin,
  onClose
}: {
  state: StateHook;
  project?: ModrinthProjectDto;
  version?: ModrinthVersionDto;
  localPath?: string;
  /** Overrides the name derived from the pack, e.g. to include its version. */
  initialName?: string;
  /**
   * Identifies the pack when there is no `ModrinthProjectDto` for it, which is
   * the case when the install starts from an instance the launcher installed
   * earlier: the manifest knows the pack's own name but not Modrinth's project
   * page, so there is no project to show.
   */
  origin?: { slug: string; title: string; author: string; description: string };
  onClose?: () => void;
}): React.JSX.Element {
  const defaultName = useMemo(() => {
    if (initialName !== undefined) return initialName;
    if (project !== undefined) return sanitizeInstanceName(project.title);
    if (origin !== undefined) return sanitizeInstanceName(origin.title);
    if (localPath !== undefined) return instanceNameFromPath(localPath);
    return '安装整合包';
  }, [initialName, project, origin, localPath]);

  const [name, setName] = useState(defaultName);
  const [invalid, setInvalid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [progress, setProgress] = useState<DownloadProgressDto | undefined>(undefined);
  const [inspect, setInspect] = useState<ModpackInspectDto | undefined>(undefined);
  const [showDescription, setShowDescription] = useState(false);
  const [canRetry, setCanRetry] = useState(false);

  useEffect(() => {
    if (localPath !== undefined) {
      hmcl()
        .inspectModpackFile(localPath)
        .then((meta) => {
          setInspect(meta);
          if (meta.name !== undefined && meta.name !== '') setName(sanitizeInstanceName(meta.name));
        })
        .catch(() => setInspect(undefined));
    }
  }, [localPath]);

  // The install flows broadcast all progress with launchId -1, so only one
  // wizard can be installing at any time without cross-talk.
  useEffect(() => {
    const unsubscribe = hmcl().onEvent((event) => {
      if (event.kind === 'download-progress' && event.launchId === -1) {
        setProgress(event.progress);
      }
    });
    return unsubscribe;
  }, []);

  const packName = inspect?.name ?? project?.title ?? origin?.title ?? '未知整合包';
  const packVersion = inspect?.version ?? (version !== undefined ? version.versionNumber : '');
  const packAuthor = inspect?.author ?? project?.author ?? origin?.author ?? '';
  const description =
    localPath !== undefined ? (inspect?.summary ?? '') : (project?.description ?? origin?.description ?? '');

  const startInstall = async (): Promise<void> => {
    if (!/^[0-9A-Za-z._-]+$/.test(name)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setBusy(true);
    setError(undefined);
    setProgress(undefined);
    setCanRetry(false);
    try {
      const created =
        version !== undefined
          ? await hmcl().installModrinthModpack(project?.slug ?? origin!.slug, version.id, name)
          : await hmcl().installModpackFile(localPath!, name);
      await state.refreshInstalled();
      state.setCurrentId(created);
      state.appendLog({ text: `>>> 整合包安装完成：${created}`, isError: false });
      if (onClose !== undefined) onClose();
    } catch (reason) {
      const msg = String(reason);
      let friendly = msg;
      if (msg.includes('ECONNREFUSED') || msg.includes('ENOTFOUND') || msg.includes('timeout')) {
        friendly = '网络连接失败，请检查网络后重试';
      } else if (msg.includes('403') || msg.includes('404') || msg.includes('Not Found')) {
        friendly = '文件未找到或已失效，可能需要更新整合包索引';
      } else if (msg.includes('SHA-1') || msg.includes('checksum') || msg.includes('hash')) {
        friendly = '文件校验失败，下载的文件可能已损坏，请重试';
      } else if (msg.includes('UNRECOGNIZED')) {
        friendly = '无法识别的整合包格式，请确保是 .mrpack 或 .zip 文件';
      } else if (msg.includes('此实例已经存在')) {
        friendly = '该实例名称已存在，请换一个名字';
      } else if (msg.includes('没有声明 Minecraft 版本')) {
        friendly = '整合包缺少版本信息，可能是不完整的文件';
      }
      state.appendLog({ text: msg, isError: true });
      setBusy(false);
      setError(friendly);
      setCanRetry(true);
    }
  };

  const cancelInstall = (): void => {
    if (onClose !== undefined) onClose();
  };

  const percent =
    progress !== undefined && progress.total > 0
      ? Math.min(100, Math.round((progress.completed / progress.total) * 100))
      : 0;

  const eta = progress?.bytesPerSecond && progress.bytesPerSecond > 0 && progress.totalBytes
    ? Math.round((progress.totalBytes - progress.downloadedBytes) / progress.bytesPerSecond)
    : undefined;

  return (
    <div className="install-page">
      <div className="install-page-nav">
        <button
          className="icon-button"
          title="返回"
          aria-label="返回"
          onClick={cancelInstall}
          disabled={busy}
        >
          <ArrowBackIcon size={20} />
        </button>
        <span className="install-page-title">安装整合包</span>
      </div>
      <div className="install-page-body">
        <div className="card install-week-card">
          <div className="install-week-title">当前选中的整合包</div>
          {!busy && (
            <>
              <label className="installer-row">
                <span className="installer-value">
                  <input
                    className="instance-name-input"
                    value={name}
                    onChange={(event) => {
                      setName(event.target.value);
                      setInvalid(false);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') void startInstall();
                    }}
                  />
                </span>
                <span className="installer-name">实例名称</span>
                {invalid && <em className="field-error">名称只能包含字母、数字、. _ -</em>}
              </label>
              <div className="installer-row">
                <span>整合包名称</span>
                <span>{packName}</span>
              </div>
              <div className="installer-row">
                <span>整合包版本</span>
                <span>{packVersion === '' ? '未知' : packVersion}</span>
              </div>
              <div className="installer-row">
                <span>作者</span>
                <span>{packAuthor === '' ? '未知' : packAuthor}</span>
              </div>
              {description !== '' && (
                <div className="installer-row description-row">
                  <span>整合包描述</span>
                  <button
                    className="border-button"
                    onClick={() => setShowDescription((current) => !current)}
                  >
                    查看描述
                  </button>
                </div>
              )}
              {showDescription && description !== '' && (
                <div className="install-description">{description}</div>
              )}
              {error !== undefined && <div className="field-error install-error">安装失败：{error}</div>}
              <div className="install-actions">
                <button className="raised-button" onClick={() => void startInstall()}>
                  安装
                </button>
                {canRetry && (
                  <button className="border-button" onClick={() => void startInstall()}>
                    重试
                  </button>
                )}
              </div>
            </>
          )}
          {busy && (
            <div className="install-progress">
              <div className="progress-percent">{percent}%</div>
              {progress !== undefined && (
                <>
                  <div className="progress-count">
                    第 {progress.completed} / {progress.total} 个文件
                  </div>
                  {progress.currentFile !== undefined && (
                    <div className="progress-file">{progress.currentFile}</div>
                  )}
                  {progress.bytesPerSecond > 0 && (
                    <div className="progress-speed">
                      {formatBytes(progress.bytesPerSecond)}/s
                      {eta !== undefined && eta > 0 && (
                        <span className="progress-eta"> · 预计剩余 {eta}s</span>
                      )}
                    </div>
                  )}
                </>
              )}
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${percent}%` }} />
              </div>
              <div className="install-progress-actions">
                <button className="text-button" onClick={cancelInstall} disabled={percent >= 100}>
                  取消
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Version chooser behind the instance list's update button.
 *
 * HMCL's `Instances.updateInstance` re-runs the install wizard on the *same*
 * instance id, which replaces what is installed. This lists the pack's versions
 * and installs the picked one as a *new* instance, so every version stays
 * launchable and a bad update costs nothing to undo. Only packs this launcher
 * downloaded from Modrinth can get here: no modpack format states its own
 * project, so an instance imported from a local file has nothing to ask.
 */
function ModpackVersionsPage({
  state,
  instanceId,
  onClose
}: {
  state: StateHook;
  instanceId: string;
  onClose: () => void;
}): React.JSX.Element {
  const [choice, setChoice] = useState<ModpackVersionChoiceDto | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [picked, setPicked] = useState<ModrinthVersionDto | undefined>(undefined);
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setChoice(undefined);
    setError(undefined);
    hmcl()
      .modpackOtherVersions(instanceId)
      .then((result) => {
        if (!live) return;
        if (result === undefined) {
          setError('该整合包没有记录来源项目，无法列出其他版本。请从「下载」页面重新安装。');
          return;
        }
        setChoice(result);
        // Preselect the newest version that is not the installed one, which is
        // the version the user came here for.
        const installed = result.versions.find(
          (entry) => entry.versionNumber === result.installedVersion
        );
        const firstOther = result.versions.find((entry) => entry.id !== installed?.id);
        setSelectedId(firstOther?.id ?? result.versions[0]?.id);
      })
      .catch((e) => live && setError(String(e)));
    return () => {
      live = false;
    };
  }, [instanceId, attempt]);

  if (picked !== undefined && choice !== undefined) {
    return (
      <ModpackInstallPage
        state={state}
        version={picked}
        initialName={uniqueInstanceName(
          `${sanitizeInstanceName(choice.name)}-${sanitizeInstanceName(picked.versionNumber)}`,
          state.installed.map((entry) => entry.id)
        )}
        origin={{
          slug: choice.projectId,
          title: choice.name,
          author: '',
          description: ''
        }}
        onClose={onClose}
      />
    );
  }

  return (
    <div className="install-page">
      <div className="install-page-nav">
        <button className="icon-button" title="返回" aria-label="返回" onClick={onClose}>
          <ArrowBackIcon size={20} />
        </button>
        <span className="install-page-title">选择整合包版本</span>
      </div>
      <div className="install-page-body">
        <div className="card install-week-card">
          <div className="install-week-title">
            {choice === undefined ? (error === undefined ? '正在读取版本…' : '无法读取版本') : choice.name}
          </div>
          {error !== undefined && (
            <>
              <div className="field-error install-error">{error}</div>
              <div className="install-actions">
                <button className="raised-button" onClick={() => setAttempt((n) => n + 1)}>
                  重试
                </button>
              </div>
            </>
          )}
          {choice !== undefined && (
            <>
              <div className="installer-row">
                <span>已安装版本</span>
                <span>{choice.installedVersion}</span>
              </div>
              <div className="installer-row description-row">
                <span>选择一个版本装成新实例，旧的会保留</span>
              </div>
              <div className="version-choice-list">
                {choice.versions.map((entry) => {
                  const installed = entry.versionNumber === choice.installedVersion;
                  return (
                    <label key={entry.id} className="version-choice">
                      <input
                        type="radio"
                        name="modpack-version"
                        checked={selectedId === entry.id}
                        onChange={() => setSelectedId(entry.id)}
                      />
                      <span className="version-choice-main">
                        <span className="version-choice-number">{entry.versionNumber}</span>
                        {installed && <span className="tag">已安装</span>}
                      </span>
                      <span className="version-choice-meta">
                        {entry.gameVersions.join(', ')}
                        {entry.datePublished !== undefined && ` · ${entry.datePublished.slice(0, 10)}`}
                      </span>
                    </label>
                  );
                })}
              </div>
              <div className="install-actions">
                <button
                  className="raised-button"
                  disabled={selectedId === undefined}
                  onClick={() =>
                    setPicked(choice.versions.find((entry) => entry.id === selectedId))
                  }
                >
                  安装此版本
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Appends a counter until the name is free. The install page already explains a
 * taken name, but two versions of one pack default to the same base and a
 * suffix is friendlier than an error.
 */
function uniqueInstanceName(base: string, taken: readonly string[]): string {
  if (!taken.includes(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.includes(candidate)) return candidate;
  }
}

/**
 * Placeholder for the world category: Modrinth has no world project type, so
 * this page explains the situation and offers local save/modpack import.
 */
function UnsupportedCategory({ state }: StateHookProps): React.JSX.Element {
  const [importing, setImporting] = useState(false);
  const importPack = async (): Promise<void> => {
    if (importing) return;
    setImporting(true);
    try {
      const picked = await hmcl().pickModpackFile();
      if (picked !== undefined) {
        const instanceName = picked
          .split(/[/\\]/)
          .pop()
          ?.replace(/\.[^.]+$/, '')
          .replace(/[^0-9A-Za-z._-]+/g, '-');
        const created = await hmcl().installModpackFile(
          picked,
          instanceName || `导入_${Date.now()}`
        );
        state.appendLog({ text: `已导入整合包实例: ${created}`, isError: false });
        await state.refreshInstalled();
      }
    } catch (error) {
      state.appendLog({ text: `导入失败: ${String(error)}`, isError: true });
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="dl-list-wrap">
      <div className="notice-pane">
        <div className="notice-title">这里没有「世界」可供下载</div>
        <p>
          Modrinth 不提供独立的存档/世界下载。需要冒险地图或整合实例时，请把
          <code>.zip</code> 或 <code>.mrpack</code> 整合包文件拖入启动器窗口，即可自动创建实例。
        </p>
        <button
          className="text-button"
          disabled={importing}
          onClick={() => void importPack()}
        >
          {importing ? '导入中…' : '选择本地整合包…'}
        </button>
      </div>
    </div>
  );
}

/** Formats a byte count using HMCL's download.speed.* conventions. */
function formatSpeed(bytesPerSecond: number): string {
  if (bytesPerSecond >= 1024 * 1024) return `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MiB/s`;
  if (bytesPerSecond >= 1024) return `${(bytesPerSecond / 1024).toFixed(1)} KiB/s`;
  return `${Math.round(bytesPerSecond)} B/s`;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${Math.round(bytes)} B`;
}

/**
 * Download completion in percent, or undefined while it cannot be known.
 *
 * Bytes come first: a single mod pack is one file, so the file counter sits at
 * 0/1 for the whole download and would leave the bar pinned at 0%.
 */
function downloadPercent(progress: DownloadProgressDto | undefined): number | undefined {
  if (progress === undefined) return undefined;
  if (progress.totalBytes !== undefined && progress.totalBytes > 0) {
    return Math.min(100, Math.round((progress.downloadedBytes / progress.totalBytes) * 100));
  }
  if (progress.total > 0) {
    return Math.min(100, Math.round((progress.completed / progress.total) * 100));
  }
  return undefined;
}

function formatMiB(mib: number): string {
  if (mib >= 1024) return `${(mib / 1024).toFixed(1)} GiB`;
  return `${Math.round(mib)} MiB`;
}

/**
 * Bottom progress bar for anything long-running: a download (determinate, with
 * the current file and transfer rate) or a launch that has no download to show
 * (indeterminate). The launch case is what gives the instance list and instance
 * manage pages any feedback at all — neither has a sidebar or a status line.
 */
function LaunchFooter({
  progress,
  stage
}: {
  progress: DownloadProgressDto | undefined;
  stage: string;
}): React.JSX.Element {
  const percent = downloadPercent(progress);

  return (
    <div className="dl-footer">
      <div className="dl-footer-top">
        <span className="dl-footer-stage">{stage}</span>
        {progress !== undefined && progress.total > 0 && (
          <span className="dl-footer-files">
            {progress.completed}/{progress.total} 文件
          </span>
        )}
      </div>
      <div className="dl-progress">
        <div
          className={`dl-progress-fill${percent === undefined ? ' indeterminate' : ''}`}
          style={percent === undefined ? undefined : { width: `${percent}%` }}
        />
      </div>
      {progress !== undefined && (progress.currentFile !== undefined || progress.bytesPerSecond > 0) && (
        <div className="dl-footer-bottom">
          {progress.currentFile !== undefined && (
            <span className="dl-current-file" title={progress.currentFile}>
              {progress.currentFile}
            </span>
          )}
          <span className="dl-footer-metrics">
            {progress.bytesPerSecond > 0 && <span>{formatSpeed(progress.bytesPerSecond)}</span>}
            {progress.totalBytes !== undefined && (
              <span>
                {formatBytes(progress.downloadedBytes)}/{formatBytes(progress.totalBytes)}
              </span>
            )}
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * Export page for 导出整合包, mirroring HMCL's `ModpackInfoPage`.
 *
 * HMCL runs a three-step wizard (type -> info -> file selection) covering four
 * pack formats. Only the Modrinth `.mrpack` target is implemented, so the type
 * step is gone and the file selection step is answered by the fixed default
 * that `ModAdviser.MODPACK_SUGGESTED_BLACK_LIST` describes: worlds, client
 * options and other per-machine state stay out of the archive.
 */
function ModpackExportSheet({
  state,
  instanceId,
  onClose
}: {
  state: StateHook;
  instanceId: string;
  onClose: () => void;
}): React.JSX.Element {
  const [loaded, setLoaded] = useState(false);
  const [name, setName] = useState(instanceId);
  const [version, setVersion] = useState('1.0.0');
  const [summary, setSummary] = useState('');
  const [nameInvalid, setNameInvalid] = useState(false);
  const [versionInvalid, setVersionInvalid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  // An instance that came from a modpack opens on that pack's own name and
  // version; a plain instance opens on its id. HMCL reads the same values off
  // the instance (`ModpackInfoPage:212`).
  useEffect(() => {
    let disposed = false;
    void hmcl()
      .modpackExportDefaults(instanceId)
      .then((value) => {
        if (disposed) return;
        setLoaded(true);
        setName(value.name);
        setVersion(value.version);
        setSummary(value.summary ?? '');
      })
      .catch((reason: unknown) => {
        if (!disposed) setError(String(reason));
      });
    return () => {
      disposed = true;
    };
  }, [instanceId]);

  const submit = async (): Promise<void> => {
    const trimmedName = name.trim();
    const trimmedVersion = version.trim();
    setNameInvalid(trimmedName === '');
    setVersionInvalid(trimmedVersion === '');
    if (trimmedName === '' || trimmedVersion === '') return;
    setBusy(true);
    setError(undefined);
    try {
      // The main process shows the save dialog, so the name typed here only
      // decides the suggested file name and the index inside the archive.
      const exported = await hmcl().exportModpack(instanceId, {
        name: trimmedName,
        version: trimmedVersion,
        summary: summary.trim() === '' ? undefined : summary.trim()
      });
      if (exported !== undefined) {
        state.showToast(`整合包已导出：${exported.path}（${exported.files} 个文件）`);
        onClose();
      }
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  };

  const source = state.installed.find((entry) => entry.id === instanceId)?.modpack;

  return (
    <div className="sheet-backdrop" onClick={busy ? undefined : onClose}>
      <div className="sheet modpack-export-sheet" onClick={(event) => event.stopPropagation()}>
        <h3 className="sheet-title">导出整合包</h3>
        <div className="sheet-body">
          <div className="field">
            <span>实例</span>
            <code>{instanceId}</code>
          </div>
          <div className="field">
            <span>格式</span>
            <code>.mrpack</code>
          </div>
          {source !== undefined && (
            <div className="field">
              <span>来源</span>
              <code>
                {source.name} {source.version}
              </code>
            </div>
          )}
          <label className="field">
            <span>名称</span>
            <input value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          {nameInvalid && <em className="field-error">请填写整合包名称</em>}
          <label className="field">
            <span>版本</span>
            <input value={version} onChange={(event) => setVersion(event.target.value)} />
          </label>
          {versionInvalid && <em className="field-error">请填写整合包版本</em>}
          <label className="field">
            <span>简介</span>
            <input
              value={summary}
              placeholder="选填，会写进 modrinth.index.json"
              onChange={(event) => setSummary(event.target.value)}
            />
          </label>
          <p className="notice-text">
            存档、客户端设置、日志与启动器缓存不会写进整合包，这一点与 HMCL
            的默认导出选择一致。游戏版本与加载器会记在 modrinth.index.json 里。
          </p>
          {error !== undefined && <div className="dialog-error">{error}</div>}
        </div>
        <div className="sheet-actions">
          <button className="raised-button" onClick={() => void submit()} disabled={busy || !loaded}>
            导出
          </button>
          <button className="text-button" onClick={onClose} disabled={busy}>
            取消
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The icon chooser behind the instance settings' 游戏图标 row, mirroring
 * `GameInstanceIconDialog`: a flow of the built-in icons plus a tile that opens
 * a file chooser. No labels there either — the pictures are the labels, and a
 * caption under each one would only crowd a 36px tile.
 */
function InstanceIconPickerSheet({
  current,
  onPickType,
  onPickFile,
  onClose
}: {
  /** The picked icon id, when the instance has one. */
  current: string | undefined;
  onPickType: (id: string) => void;
  onPickFile: () => void;
  onClose: () => void;
}): React.JSX.Element {
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet icon-picker-sheet" onClick={(event) => event.stopPropagation()}>
        <h3 className="sheet-title">游戏图标</h3>
        <div className="sheet-body icon-picker-grid">
          <button
            className={`icon-picker-tile custom${current === undefined ? ' selected' : ''}`}
            title="从文件选择"
            aria-label="从文件选择"
            onClick={onPickFile}
          >
            <AddIcon size={22} />
          </button>
          {INSTANCE_ICONS.map((entry) => (
            <button
              key={entry.id}
              className={`icon-picker-tile${current === entry.id ? ' selected' : ''}`}
              title={entry.id}
              aria-label={entry.id}
              aria-pressed={current === entry.id}
              onClick={() => onPickType(entry.id)}
            >
              <img src={entry.asset} alt="" />
            </button>
          ))}
        </div>
        <div className="sheet-actions">
          <button className="text-button" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Terracotta placeholder page. The original HMCL bundles a world/skin browse
 * UI here; the rewrite intentionally ships a readable explanation instead.
 */
function TerracottaPage(): React.JSX.Element {
  return (
    <div className="page list-page">
      <h2 className="page-title">Terracotta</h2>
      <div className="card settings-card">
        <div className="card-title">世界与皮肤浏览器（占位）</div>
        <p className="notice-text">
          原版 HMCL 的 Terracotta 子程序用于浏览下载他人的地图存档、皮肤与披风。
          本重写版当前不提供该功能。需要地图整合包时，可将 <code>.zip</code> /{' '}
          <code>.mrpack</code> 文件直接拖入启动器窗口完成导入。
        </p>
        <p className="notice-text">
          皮肤与披风浏览暂未实现；如需自定义皮肤，可配合第三方皮肤站（如
          <code>littleskin.cn</code>）与离线账户使用。
        </p>
      </div>
    </div>
  );
}

type SettingsTab =
  | 'game'
  | 'java'
  | 'general'
  | 'appearance'
  | 'download'
  | 'help'
  | 'feedback'
  | 'about';

/** Persistent-save helper shared by every settings tab. */
function makeSettingsSave(state: StateHook): (partial: Partial<SettingsDto>) => void {
  return (partial) => {
    const next = { ...state.settings, ...partial };
    state.setSettings(next);
    void hmcl()
      .saveSettings(partial)
      .catch((error) => state.appendLog({ text: String(error), isError: true }));
  };
}

/**
 * Settings are stored as `true` or absent, never as an explicit `false`, so an
 * off toggle leaves no trace in settings.json. `JSON.stringify` drops the
 * `undefined`, which is what makes "absent" and "off" the same state.
 */
function enabled(value: boolean | undefined): true | undefined {
  return value === true ? true : undefined;
}

/**
 * One choice of a mutually exclusive group, mirroring HMCL's
 * `RadioChoiceList.Choice`: a radio on the right, a title and optional subtitle
 * on the left. Unlike a <select>, every option stays visible, which is what lets
 * a choice carry its own control (HMCL hangs the theme-color picker off the
 * 自定义颜色 option) or its own subtitle.
 */
function SettingsChoice({
  title,
  subtitle,
  name,
  value,
  checked,
  onSelect,
  children
}: {
  title: string;
  subtitle?: string | undefined;
  name: string;
  value: string;
  checked: boolean;
  onSelect: () => void;
  children?: React.ReactNode;
}): React.JSX.Element {
  // A <label> rather than a div, so the whole row selects the option the way
  // HMCL's RadioChoiceList does — no hit-target to get wrong.
  return (
    <label className={`settings-choice${checked ? ' checked' : ''}`}>
      <input
        type="radio"
        className="settings-choice-radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onSelect}
      />
      <div className="settings-row-label">
        <span>{title}</span>
        {subtitle !== undefined && <span className="settings-row-subtitle">{subtitle}</span>}
      </div>
      {children}
    </label>
  );
}

/** Page header shown on top of each settings tab: title plus a short hint. */
function SettingsTabHeader({ title, subtitle }: { title: string; subtitle: string }): React.JSX.Element {
  return (
    <header className="settings-header">
      <h2 className="page-title">{title}</h2>
      <p className="settings-subtitle">{subtitle}</p>
    </header>
  );
}

/**
 * One titled block of setting rows.
 *
 * This is HMCL's `ComponentList.createComponentListTitle` followed by the
 * `ComponentList` it titles: a plain label above a rounded, gapless list of
 * rows. `help` is the second argument of `createComponentListTitle`, the little
 * question mark whose tooltip explains the section.
 *
 * Both settings surfaces — the instance panel and the launcher's own tabs — are
 * built from this, which is why they look the same.
 */
function SettingsSection({
  title,
  help,
  children
}: {
  title: string;
  help?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="settings-section">
      <div className="settings-section-title">
        {title}
        {help !== undefined && (
          <span className="settings-section-help" title={help} aria-label={help}>
            <HelpIcon size={14} />
          </span>
        )}
      </div>
      <div className="settings-section-list">{children}</div>
    </div>
  );
}

/**
 * One row of a {@link SettingsSection}, mirroring HMCL's `LineComponent`: a 13px
 * title with an optional 12px subtitle on the left, the control on the right.
 *
 * The control is left out for rows that only display something read-only — a
 * path, a version — which then spans the full width like a `Subtitle` line in
 * HMCL. Pass `check` for a boolean row, so the checkbox sits on the right where
 * HMCL puts it instead of being smuggled in through `children`.
 */
function SettingsRow({
  title,
  subtitle,
  check,
  onCheckChange,
  children
}: {
  title: string;
  subtitle?: string;
  check?: boolean;
  onCheckChange?: (checked: boolean) => void;
  children?: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="settings-row">
      <div className="settings-row-label">
        <span>{title}</span>
        {subtitle !== undefined && <span className="settings-row-subtitle">{subtitle}</span>}
      </div>
      {check !== undefined && (
        <input
          type="checkbox"
          className="settings-row-check"
          checked={check}
          onChange={(event) => onCheckChange?.(event.target.checked)}
        />
      )}
      {children}
    </div>
  );
}

/** HMCL keeps a repository of Minecraft versions, managed in this tab. */
function GameSettingsTab({ state }: StateHookProps): React.JSX.Element {
  const save = makeSettingsSave(state);
  return (
    <div className="settings-scroll">
      <SettingsTabHeader title="全局游戏设置" subtitle="非隔离实例共用的游戏设置。" />
      <SettingsSection title="基础">
        <SettingsRow title="最大内存（MiB）" subtitle="留给游戏的堆大小">
          <input
            type="number"
            value={state.settings.maxMemory ?? 4096}
            min={128}
            onChange={(event) => save({ maxMemory: Number(event.target.value) || undefined })}
          />
        </SettingsRow>
      </SettingsSection>
      <SettingsSection title="游戏">
        <SettingsRow title="当前游戏目录" subtitle="所有非隔离实例共用的目录">
          <code className="settings-row-value">{state.settings.gameDir}</code>
        </SettingsRow>
      </SettingsSection>
    </div>
  );
}

/** Java runtime detection and selection, mirroring HMCL's Java 管理 tab. */
function JavaSettingsTab({ state }: StateHookProps): React.JSX.Element {
  const save = makeSettingsSave(state);

  const pickJava = async (): Promise<void> => {
    const path = await hmcl().pickJavaExecutable();
    if (path !== undefined) save({ javaExecutable: path });
  };

  return (
    <div className="settings-scroll">
      <SettingsTabHeader title="Java 管理" subtitle="检测并选择用于启动游戏的 Java 运行时。" />
      <SettingsSection title="Java 运行时">
        <SettingsRow
          title="自动检测"
          subtitle="按游戏版本挑选合适的 JRE"
          check={state.settings.javaExecutable === undefined}
          onCheckChange={() => save({ javaExecutable: undefined })}
        />
        {state.javas.map((java) => (
          <SettingsRow
            key={java.executable}
            title={`Java ${java.versionString}`}
            subtitle={java.executable}
            check={java.executable === state.settings.javaExecutable}
            onCheckChange={() => save({ javaExecutable: java.executable })}
          />
        ))}
        <SettingsRow title="自定义路径" subtitle={state.settings.javaExecutable ?? '未选择'}>
          <button className="border-button" onClick={() => void pickJava()}>
            浏览…
          </button>
        </SettingsRow>
      </SettingsSection>
      {state.javas.length === 0 && (
        <p className="notice-text">
          未检测到 Java 运行时。安装一个 JRE 8 或更高版本后重新进入本页即可看到。
        </p>
      )}
    </div>
  );
}

/**
 * Opens the log folder. Both log actions are best-effort — they hand off to the
 * desktop's file manager, which may not exist — so a failure goes to the log
 * rather than becoming an unhandled rejection.
 */
const openLogFolder = (state: StateHook): void => {
  void hmcl()
    .openLogFolder()
    .catch((error: unknown) =>
      state.appendLog({ text: `打开日志文件夹失败: ${String(error)}`, isError: true })
    );
};

/** Writes the session log to a timestamped file and reveals it. */
const exportLogs = (state: StateHook): void => {
  void state
    .exportLogs()
    .catch((error: unknown) =>
      state.appendLog({ text: `导出日志失败: ${String(error)}`, isError: true })
    );
};

/** Launcher-wide behavior: update channel, April Fools and log export. */
function GeneralSettingsTab({ state }: StateHookProps): React.JSX.Element {
  const save = makeSettingsSave(state);
  return (
    <div className="settings-scroll">
      <SettingsTabHeader title="通用" subtitle="更新、语言与调试。" />
      {/* HMCL's section titles here are update / language / misc; its rows carry
          the same labels, so the pair reads the same as it does there. */}
      <SettingsSection title="启动器更新">
        <SettingsRow title="启动器更新">
          <select
            value={state.settings.updateChannel ?? 'stable'}
            onChange={(event) =>
              save({ updateChannel: event.target.value === 'stable' ? undefined : 'dev' })
            }
          >
            <option value="stable">稳定版</option>
            <option value="dev">开发版</option>
          </select>
        </SettingsRow>
      </SettingsSection>
      <SettingsSection title="语言">
        <SettingsRow title="语言" subtitle="重启后生效">
          <select
            value={state.settings.language ?? 'zh_cn'}
            onChange={(event) => save({ language: event.target.value })}
          >
            <option value="zh_cn">简体中文</option>
            <option value="en_us">English (US)</option>
            <option value="zh_tw">繁體中文</option>
            <option value="ja_jp">日本語</option>
            <option value="ko_kr">한국어</option>
            <option value="de_de">Deutsch</option>
            <option value="fr_fr">Français</option>
            <option value="ru_ru">Русский</option>
            <option value="es_es">Español</option>
            <option value="pt_br">Português (Brasil)</option>
          </select>
        </SettingsRow>
      </SettingsSection>
      <SettingsSection title="杂项">
        {/* HMCL stores disable_april_fools, so its checkbox is the negation of
            ours; the stored value keeps its existing meaning either way. */}
        <SettingsRow
          title="不启用愚人节功能"
          subtitle="重启后生效"
          check={state.settings.aprilFools === true ? false : true}
          onCheckChange={(checked) => save({ aprilFools: checked ? undefined : true })}
        />
        <SettingsRow title="调试" subtitle="启动器日志位于用户数据目录的 logs 文件夹">
          <button className="border-button" onClick={() => openLogFolder(state)}>
            打开日志文件夹
          </button>
          <button className="border-button" onClick={() => exportLogs(state)}>
            导出启动器日志
          </button>
        </SettingsRow>
      </SettingsSection>
    </div>
  );
}

/** Launcher look & feel: accent color and background image, mirroring HMCL's PersonalizationPage. */
function AppearanceSettingsTab({ state }: StateHookProps): React.JSX.Element {
  const save = makeSettingsSave(state);
  const pickBackground = async (): Promise<void> => {
    try {
      const path = await hmcl().pickThemeBackground();
      if (path !== undefined) save({ themeBackground: path });
    } catch (error) {
      state.appendLog({ text: `选择背景图失败: ${String(error)}`, isError: true });
    }
  };
  const background = state.settings.themeBackground;
  // A stored color with no type predates the three-way choice (there was only a
  // color input before), so it has to keep counting as custom — otherwise an
  // existing configuration would silently fall back to the built-in blue.
  const customColor =
    state.settings.themeColorType === 'custom' ||
    (state.settings.themeColorType === undefined && state.settings.themeColor !== undefined);
  const transparent = state.settings.launcherBackgroundTransparent ?? false;
  const titleBarTransparent = state.settings.titleBarTransparent ?? false;
  const reapplyTransparency = (): void => {
    void hmcl()
      .fixBackgroundTransparency()
      .then(() => state.appendLog({ text: '已重新应用透明背景', isError: false }))
      .catch((error) =>
        state.appendLog({ text: `修复透明背景失败: ${String(error)}`, isError: true })
      );
  };

  return (
    <div className="settings-scroll">
      <SettingsTabHeader title="外观" subtitle="主题色、背景与窗口透明。" />
      <SettingsSection title="主题">
        <SettingsChoice
          title="默认"
          subtitle="使用启动器内置的主题色"
          name="theme-color-type"
          value="default"
          checked={!customColor}
          onSelect={() => save({ themeColor: undefined, themeColorType: undefined })}
        />
        {/* HMCL also has 跟随系统 here, which needs the OS accent color; Electron
            exposes no cross-platform API for it, so it waits. */}
        <SettingsChoice
          title="自定义颜色"
          subtitle={customColor ? (state.settings.themeColor ?? '') : '启用此选项，自定义启动器主题色'}
          name="theme-color-type"
          value="custom"
          checked={customColor}
          onSelect={() =>
            save({
              themeColor: state.settings.themeColor ?? DEFAULT_THEME_COLOR,
              themeColorType: 'custom'
            })
          }
        >
          {customColor && (
            <input
              type="color"
              className="color-input"
              value={state.settings.themeColor ?? DEFAULT_THEME_COLOR}
              onChange={(event) => save({ themeColor: event.target.value })}
            />
          )}
        </SettingsChoice>
      </SettingsSection>
      <SettingsSection title="启动器背景">
        <SettingsChoice
          title="默认"
          subtitle="使用启动器内置的背景"
          name="background-type"
          value="default"
          checked={background === undefined}
          onSelect={() => save({ themeBackground: undefined })}
        />
        <SettingsChoice
          title="自定义"
          subtitle={background ?? '启用此选项，自定义启动器背景'}
          name="background-type"
          value="custom"
          checked={background !== undefined}
          onSelect={() => void pickBackground()}
        />
      </SettingsSection>
      <SettingsSection title="窗口">
        <SettingsRow
          title="标题栏透明"
          subtitle="标题栏不再绘制自己的底色"
          check={titleBarTransparent}
          onCheckChange={(checked) => save({ titleBarTransparent: enabled(checked) })}
        />
        <SettingsRow
          title="窗口透明"
          subtitle="Linux 下需要桌面合成器（Compositor）支持"
          check={transparent}
          onCheckChange={(checked) => save({ launcherBackgroundTransparent: enabled(checked) })}
        />
        <SettingsRow title="透明未生效" subtitle="重新应用一次透明背景设置">
          <button className="border-button" disabled={!transparent} onClick={reapplyTransparency}>
            尝试修复
          </button>
        </SettingsRow>
      </SettingsSection>
    </div>
  );
}

/** Download settings mirroring HMCL's DownloadSettingsPage. */
function DownloadSettingsTab({ state }: StateHookProps): React.JSX.Element {
  const save = makeSettingsSave(state);
  const autoThreads = state.settings.autoDownloadThreads !== false;

  return (
    <div className="settings-scroll">
      <SettingsTabHeader title="下载" subtitle="下载源、缓存目录与代理设置。" />

      <SettingsSection title="下载源">
        <SettingsRow title="版本列表源">
          <select
            value={state.settings.downloadMirror}
            onChange={(event) =>
              save({ downloadMirror: event.target.value as SettingsDto['downloadMirror'] })
            }
          >
            <option value="bmclapi">BMCLAPI（国内推荐）</option>
            <option value="mojang">Mojang 官方源</option>
          </select>
        </SettingsRow>
        <SettingsRow title="文件下载源">
          <select
            value={state.settings.fileDownloadSource ?? 'bmclapi'}
            onChange={(event) =>
              save({ fileDownloadSource: event.target.value as SettingsDto['fileDownloadSource'] })
            }
          >
            <option value="bmclapi">BMCLAPI（国内推荐）</option>
            <option value="mojang">Mojang 官方源</option>
          </select>
        </SettingsRow>
        <SettingsRow title="默认附加组件源" subtitle="安装模组、资源包与光影时的默认来源">
          <select
            value={state.settings.defaultAddonSource ?? 'modrinth'}
            onChange={(event) =>
              save({ defaultAddonSource: event.target.value as SettingsDto['defaultAddonSource'] })
            }
          >
            <option value="modrinth">Modrinth</option>
            <option value="curseforge">CurseForge</option>
          </select>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="下载线程">
        <SettingsRow
          title="自动"
          subtitle="按系统核心数自动决定"
          check={autoThreads}
          onCheckChange={() => save({ autoDownloadThreads: true })}
        />
        <SettingsRow
          title="自定义"
          subtitle={`${state.settings.downloadThreads ?? 64} 个线程`}
          check={!autoThreads}
          onCheckChange={() => save({ autoDownloadThreads: false })}
        >
          {!autoThreads && (
            <input
              type="range"
              min={1}
              max={256}
              value={state.settings.downloadThreads ?? 64}
              onChange={(event) => save({ downloadThreads: Number(event.target.value) })}
            />
          )}
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="缓存目录">
        <SettingsRow title="缓存目录" subtitle="存放下载的版本与库文件">
          <code className="settings-row-value">
            {state.settings.commonDirectory ?? state.settings.gameDir}
          </code>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="代理">
        <SettingsRow
          title="使用代理"
          check={state.settings.useProxy ?? false}
          onCheckChange={(checked) => save({ useProxy: enabled(checked) })}
        />
        {state.settings.useProxy === true && (
          <>
            <SettingsRow title="类型">
              <select
                value={state.settings.proxyType ?? 'http'}
                onChange={(event) => save({ proxyType: event.target.value as SettingsDto['proxyType'] })}
              >
                <option value="http">HTTP</option>
                <option value="socks5">SOCKS5</option>
              </select>
            </SettingsRow>
            <SettingsRow title="地址">
              <input
                value={state.settings.proxyHost ?? ''}
                placeholder="127.0.0.1"
                onChange={(event) => save({ proxyHost: event.target.value })}
              />
              <span className="settings-row-separator">:</span>
              <input
                type="number"
                className="settings-row-port"
                value={state.settings.proxyPort ?? 7890}
                min={1}
                max={65535}
                onChange={(event) => save({ proxyPort: Number(event.target.value) })}
              />
            </SettingsRow>
            <SettingsRow
              title="需要认证"
              check={state.settings.proxyAuth ?? false}
              onCheckChange={(checked) => save({ proxyAuth: enabled(checked) })}
            />
            {state.settings.proxyAuth === true && (
              <>
                <SettingsRow title="用户名">
                  <input
                    value={state.settings.proxyUsername ?? ''}
                    onChange={(event) => save({ proxyUsername: event.target.value })}
                  />
                </SettingsRow>
                <SettingsRow title="密码">
                  <input
                    type="password"
                    value={state.settings.proxyPassword ?? ''}
                    onChange={(event) => save({ proxyPassword: event.target.value })}
                  />
                </SettingsRow>
              </>
            )}
          </>
        )}
      </SettingsSection>
    </div>
  );
}

/**
 * A row of external links. HMCL's help, feedback and about pages are lists of
 * buttons rather than settings, so they get the same row list with no controls.
 */
function LinkRow({ title, subtitle, href }: { title: string; subtitle: string; href: string }): React.JSX.Element {
  return (
    <SettingsRow title={title} subtitle={subtitle}>
      <button className="border-button" onClick={() => void hmcl().openExternal(href)}>
        打开
      </button>
    </SettingsRow>
  );
}

/** Terse help links for launcher newcomers. */
function HelpSettingsTab(): React.JSX.Element {
  return (
    <div className="settings-scroll">
      <SettingsTabHeader title="帮助" subtitle="相关文档与资源。" />
      <SettingsSection title="相关资源">
        <LinkRow
          title="HMCL 官方文档"
          subtitle="使用教程与常见问题"
          href="https://hmcl.huangyuhui.net/help/"
        />
        <LinkRow
          title="GitHub 项目主页"
          subtitle="源代码与发布说明"
          href="https://github.com/HMCL-dev/HMCL"
        />
      </SettingsSection>
    </div>
  );
}

/** Feedback entry pointing at the upstream issue tracker. */
function FeedbackSettingsTab(): React.JSX.Element {
  return (
    <div className="settings-scroll">
      <SettingsTabHeader title="反馈" subtitle="反馈与建议。" />
      <SettingsSection title="意见与建议">
        <p className="settings-section-note">
          本重写版与上游 HMCL 共用同一个反馈渠道，欢迎前往 GitHub Issues 提交问题。
        </p>
        <LinkRow
          title="前往 GitHub Issues"
          subtitle="报告问题或提出建议"
          href="https://github.com/HMCL-dev/HMCL/issues"
        />
      </SettingsSection>
    </div>
  );
}

/** About page: version, license and upstream credit. */
function AboutSettingsTab(): React.JSX.Element {
  return (
    <div className="settings-scroll">
      <SettingsTabHeader title="关于" subtitle="版本信息与致谢。" />
      <SettingsSection title="启动器">
        <SettingsRow title={`HMCL Rewrite ${REWRITE_VERSION}`}>
          <code className="settings-row-value">
            TypeScript / Electron 重写版，界面与交互对齐原版 HMCL（GPL-3.0）
          </code>
        </SettingsRow>
        <LinkRow title="原版 HMCL 最新版本" subtitle="查看上游发布的新版本" href={HMCL_RELEASES_URL} />
      </SettingsSection>
    </div>
  );
}

/** Settings page mirroring HMCL's LauncherSettingsPage (8 tabs, sidebar navigation). */
function SettingsPage({ state }: StateHookProps): React.JSX.Element {
  const [tab, setTab] = useState<SettingsTab>('game');

  // The two groups HMCL leaves uncategorized come first, then 启动器 and 帮助 —
  // LauncherSettingsPage calls startCategory() only before the third entry, so
  // 全局游戏设置 and Java 管理 sit directly under the top of the drawer.
  const groups: {
    category: string | undefined;
    items: { id: SettingsTab; label: string; icon: React.JSX.Element }[];
  }[] = [
    {
      category: undefined,
      items: [
        { id: 'game', label: '全局游戏设置', icon: <GamepadIcon size={20} /> },
        { id: 'java', label: 'Java 管理', icon: <CoffeeIcon size={20} /> }
      ]
    },
    {
      category: '启动器',
      items: [
        { id: 'general', label: '通用', icon: <SettingsIcon size={20} /> },
        { id: 'appearance', label: '外观', icon: <PaletteIcon size={20} /> },
        { id: 'download', label: '下载', icon: <DownloadIcon size={20} /> }
      ]
    },
    {
      category: '帮助',
      items: [
        { id: 'help', label: '帮助', icon: <WikiIcon size={20} /> },
        { id: 'feedback', label: '反馈', icon: <PublicIcon size={20} /> },
        { id: 'about', label: '关于', icon: <InfoIcon size={20} /> }
      ]
    }
  ];

  return (
    <div className="settings-page">
      <aside className="dl-sidebar">
        {groups.map((group) => (
          <div key={group.category ?? 'uncategorized'}>
            {group.category !== undefined && (
              <div className="sidebar-category">{group.category}</div>
            )}
            {group.items.map((item) => (
              <button
                key={item.id}
                className={`advanced-list-item${tab === item.id ? ' selected' : ''}`}
                onClick={() => setTab(item.id)}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </div>
        ))}
      </aside>
      <main className="dl-main settings-main">
        {tab === 'game' && <GameSettingsTab state={state} />}
        {tab === 'java' && <JavaSettingsTab state={state} />}
        {tab === 'general' && <GeneralSettingsTab state={state} />}
        {tab === 'appearance' && <AppearanceSettingsTab state={state} />}
        {tab === 'download' && <DownloadSettingsTab state={state} />}
        {tab === 'help' && <HelpSettingsTab />}
        {tab === 'feedback' && <FeedbackSettingsTab />}
        {tab === 'about' && <AboutSettingsTab />}
      </main>
    </div>
  );
}

export function App(): React.JSX.Element {
  return <Shell />;
}
