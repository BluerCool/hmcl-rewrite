import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AccountDto,
  DownloadProgressDto,
  InstalledVersionDto,
  InstanceSettingsDto,
  JavaRuntimeDto,
  LauncherEvent,
  LoaderKind,
  LoaderVersionDto,
  MicrosoftDeviceCodeDto,
  ModpackInspectDto,
  ModrinthCategoryDto,
  ModrinthProjectDto,
  ModrinthProjectType,
  ModrinthSearchIndex,
  ModrinthSearchResultDto,
  ModrinthVersionDto,
  RemoteVersionDto,
  SettingsDto
} from '@hmcl/shared';
import {
  ArrowForwardIcon,
  ArrowUpIcon,
  CloseIcon,
  CoffeeIcon,
  ContentCopyIcon,
  DeleteForeverIcon,
  DownloadIcon,
  ExtensionFillIcon,
  ExtensionIcon,
  GameIcon,
  GamepadFillIcon,
  GamepadIcon,
  InfoIcon,
  ListIcon,
  MaximizeIcon,
  MicrosoftIcon,
  MinimizeIcon,
  PackageFillIcon,
  PackageIcon,
  PaletteIcon,
  PersonIcon,
  PlayIcon,
  PublicIcon,
  RestoreIcon,
  RocketIcon,
  SettingsIcon,
  SunnyFillIcon,
  SunnyIcon,
  TerminalIcon,
  TextureIcon,
  UpdateIcon,
  WikiIcon,
  ArrowBackIcon,
  EditIcon,
  MoreVertIcon
} from './icons';
import { offlineUuid } from './md5';

/** Typed accessor for the preload bridge. */
export function hmcl(): import('@hmcl/shared').HmclApi {
  return (window as unknown as { hmcl: import('@hmcl/shared').HmclApi }).hmcl;
}

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
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [stage, setStage] = useState('空闲');
  const [progress, setProgress] = useState<DownloadProgressDto | undefined>();
  const [downloading, setDownloading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deviceCode, setDeviceCode] = useState<MicrosoftDeviceCodeDto | undefined>(undefined);
  const [editingInstanceId, setEditingInstanceId] = useState<string | undefined>(undefined);
  const [maximized, setMaximized] = useState(false);

  const finishTimer = useRef<number | undefined>(undefined);
  const lastDownloadEvent = useRef<number>(0);

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

  const appendLog = (line: LogLine): void => {
    setLogs((previous) => [...previous, line].slice(-800));
  };

  const subscribeEvents = (): (() => void) =>
    hmcl().onEvent((event: LauncherEvent) => {
      switch (event.kind) {
        case 'stage':
          setStage(STAGE_LABELS[event.stage] ?? event.stage);
          break;
        case 'download-progress':
          setProgress(event.progress);
          setDownloading(event.progress.total > 0);
          lastDownloadEvent.current = Date.now();
          // Hide the bar 700ms after the LAST event (not after completion),
          // so batch transitions don't cause flicker.
          window.clearTimeout(finishTimer.current);
          finishTimer.current = window.setTimeout(() => {
            if (Date.now() - lastDownloadEvent.current >= 700) {
              setDownloading(false);
            }
          }, 700);
          break;
        case 'output':
          appendLog({ text: event.line, isError: event.isError });
          break;
        case 'exit':
          setStage(event.code === 0 ? '游戏已退出' : `游戏已退出，退出码 ${String(event.code)}`);
          setBusy(false);
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
            finishTimer.current = window.setTimeout(() => setDownloading(false), 700);
          } else {
            // Failure: stop immediately and show error in log
            setDownloading(false);
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
    logs,
    stage,
    progress,
    downloading,
    busy,
    setBusy,
    deviceCode,
    editingInstanceId,
    setEditingInstanceId,
    maximized,
    refreshInstalled,
    refreshAccounts,
    appendLog,
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
  starting: '正在启动',
  running: '游戏运行中'
};

/**
 * The main window chrome: HMCL-style left sidebar with account/instance
 * categories plus the routed content area.
 */
export function Shell(): React.JSX.Element | null {
  const state = useLauncherState();
  const [page, setPage] = useState<PageId>('home');
  const [logOpen, setLogOpen] = useState(false);
  const [downloadDetail, setDownloadDetail] = useState<ModrinthProjectDto | undefined>(undefined);
  const [bgUrl, setBgUrl] = useState<string | undefined>(undefined);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);

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
      '.nav-item, .text-button, .raised-button, .menu-button, .launch-button, .advanced-list-item, .java-list li'
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
      <div className="titlebar">
        <div className="titlebar-drag">
          <span className="titlebar-title">HMCL</span>
        </div>
        <div className="titlebar-controls">
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
        {page === 'home' ? (
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
                active={logOpen}
                onClick={() => setLogOpen((open) => !open)}
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
            <div className="nav-bar">
              <button
                className="icon-button nav-back"
                title={page === 'download' && downloadDetail !== undefined ? '返回' : '返回首页'}
                aria-label="返回"
                onClick={
                  page === 'download' && downloadDetail !== undefined
                    ? () => setDownloadDetail(undefined)
                    : () => setPage('home')
                }
              >
                <ArrowBackIcon size={20} />
              </button>
              <span className="nav-bar-title">
                {page === 'download' && downloadDetail !== undefined
                  ? downloadDetail.title
                  : PAGE_TITLES[page]}
              </span>
              <span className="nav-bar-spacer" />
              <button className="text-button" onClick={() => setLogOpen((open) => !open)}>
                <TerminalIcon size={15} />
                日志
              </button>
            </div>
            <main className="content">
              <div className="page-stage" key={page === 'download' && downloadDetail !== undefined ? `download-detail-${downloadDetail.slug}` : page}>
                {page === 'accounts' && <AccountsPage state={pageProps} />}
                {page === 'instances' && <InstancesPage state={pageProps} />}
                {page === 'download' && (
                  <DownloadPage
                    state={pageProps}
                    detail={downloadDetail}
                    onOpenDetail={setDownloadDetail}
                    onCloseDetail={() => setDownloadDetail(undefined)}
                  />
                )}
                {page === 'settings' && <SettingsPage state={pageProps} />}
                {page === 'terracotta' && <TerracottaPage />}
                {logOpen && <LogDrawer state={pageProps} onClose={() => setLogOpen(false)} />}
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
      {state.downloading && state.progress !== undefined && (
        <DownloadFooter progress={state.progress} stage={state.stage} />
      )}
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
  logs: LogLine[];
  stage: string;
  progress: DownloadProgressDto | undefined;
  downloading: boolean;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  deviceCode: MicrosoftDeviceCodeDto | undefined;
  editingInstanceId: string | undefined;
  setEditingInstanceId: (id: string | undefined) => void;
  maximized: boolean;
  refreshInstalled: (preferredSettings?: SettingsDto) => Promise<void>;
  refreshAccounts: () => Promise<void>;
  appendLog: (line: LogLine) => void;
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
      state.appendLog({ text: String(error), isError: true });
      state.setBusy(false);
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
        {state.progress !== undefined && state.progress.total > 0
          ? ` · ${state.progress.completed}/${state.progress.total} 文件`
          : ''}
      </div>

      <div className="launch-pane">
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

/** Instance management page: installed version list. */
function InstancesPage({ state }: StateHookProps): React.JSX.Element {
  const [renameTarget, setRenameTarget] = useState<string | undefined>(undefined);
  const [renameValue, setRenameValue] = useState('');

  const deleteInstance = async (id: string): Promise<void> => {
    await hmcl().deleteInstance(id);
    await state.refreshInstalled();
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
    state.setEditingInstanceId(id);
  };

  const [menuFor, setMenuFor] = useState<string | undefined>(undefined);

  const launchTest = async (id: string): Promise<void> => {
    if (state.busy) return;
    state.setBusy(true);
    state.appendLog({ text: `>>> 测试启动 ${id}`, isError: false });
    try {
      await hmcl().launch(id);
    } catch (e) {
      state.appendLog({ text: String(e), isError: true });
      state.setBusy(false);
    }
  };

  return (
    <div className="page list-page">
      <h2 className="page-title">实例列表</h2>
      {menuFor !== undefined && (
        <button className="menu-backdrop" aria-label="关闭菜单" onClick={() => setMenuFor(undefined)} />
      )}
      <ul className="instance-list">
        {state.installed.map((version) => (
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
            <span className="instance-icon">
              <GameIcon size={32} />
            </span>
            <div className="instance-info">
              <div className="primary">{version.id}</div>
              <div className="secondary">{version.type ?? 'unknown'}</div>
            </div>
            <div className="instance-actions">
              <button
                className="icon-button"
                title="测试启动"
                aria-label="测试启动"
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
                <ul className="instance-menu">
                  <li>
                    <button
                      onClick={() => { setMenuFor(undefined); void launchTest(version.id); }}
                    >
                      <RocketIcon size={17} />
                      测试启动
                    </button>
                  </li>
                  <li>
                    <button onClick={() => { setMenuFor(undefined); openSettings(version.id); }}>
                      <SettingsIcon size={17} />
                      管理
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
                      重命名
                    </button>
                  </li>
                  <li>
                    <button
                      onClick={() => { setMenuFor(undefined); void copyInstance(version.id); }}
                    >
                      <ContentCopyIcon size={17} />
                      复制
                    </button>
                  </li>
                  <li>
                    <button
                      className="delete"
                      onClick={() => { setMenuFor(undefined); void deleteInstance(version.id); }}
                    >
                      <DeleteForeverIcon size={17} />
                      删除
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

      {state.editingInstanceId !== undefined && (
        <InstanceSettingsPage
          instanceId={state.editingInstanceId}
          onClose={() => state.setEditingInstanceId(undefined)}
        />
      )}
    </div>
  );
}

function InstanceSettingsPage({
  instanceId,
  onClose
}: {
  instanceId: string;
  onClose: () => void;
}): React.JSX.Element {
  const [settings, setSettings] = useState<InstanceSettingsDto | undefined>(undefined);
  const [systemMemory, setSystemMemory] = useState<number | undefined>(undefined);

  useEffect(() => {
    void hmcl().getInstanceSettings(instanceId).then(setSettings);
    void hmcl().getSystemMemory().then(setSystemMemory);
  }, [instanceId]);

  const save = (patch: Partial<InstanceSettingsDto>): void => {
    // Filter out undefined values (exactOptionalPropertyTypes disallows undefined on optional props)
    const filtered = Object.fromEntries(
      Object.entries(patch).filter(([, v]) => v !== undefined)
    ) as Partial<InstanceSettingsDto>;
    const next: InstanceSettingsDto = { ...settings, ...filtered } as InstanceSettingsDto;
    setSettings(next);
    void hmcl().saveInstanceSettings(instanceId, next);
  };

  const pickJava = async (): Promise<void> => {
    const path = await hmcl().pickJavaExecutable();
    if (path !== undefined) save({ javaExecutable: path });
  };

  const clearJava = (): void => save({});

  if (settings === undefined) {
    return (
      <div className="instance-settings-page">
        <div className="settings-page-nav" onClick={(e) => e.stopPropagation()}>
          <button className="icon-button" title="返回" onClick={onClose}><ArrowBackIcon size={20} /></button>
          <span className="settings-page-title">实例设置 — {instanceId}</span>
        </div>
        <div className="settings-page-body"><div className="spinner" /></div>
      </div>
    );
  }

  const javaMode = settings.javaExecutable ? 'custom' : 'auto';

  return (
    <div className="instance-settings-page">
      <div className="settings-page-nav" onClick={(e) => e.stopPropagation()}>
        <button className="icon-button" title="返回" onClick={onClose}><ArrowBackIcon size={20} /></button>
        <span className="settings-page-title">实例设置 — {instanceId}</span>
        <button className="raised-button" title="测试启动" onClick={() => {
          void hmcl().launch(instanceId);
          onClose();
        }}>
          <RocketIcon size={16} /> 测试启动
        </button>
      </div>

      <div className="settings-page-body">
        <div className="settings-section-card">
          <div className="settings-section-title">基本</div>

          <div className="settings-row">
            <div className="settings-row-label">
              <span>版本隔离</span>
              <span className="settings-row-subtitle">将实例的存档与配置独立存放</span>
            </div>
            <select
              value={settings.gameDirType ?? 'global'}
              onChange={(e) => save({ gameDirType: e.target.value as 'global' | 'instance' })}
            >
              <option value="global">全局</option>
              <option value="instance">隔离</option>
            </select>
          </div>

          <div className="settings-row">
            <div className="settings-row-label">
              <span>Java 运行时</span>
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
        </div>

        <div className="settings-section-card">
          <div className="settings-section-title">游戏</div>

          <div className="settings-subsection">
            <div className="settings-subsection-title">内存</div>

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
                  <span>自动分配</span>
                </label>
                <label className="radio-option">
                  <input
                    type="radio"
                    name="memory-mode"
                    checked={settings.autoMemory === false}
                    onChange={(e) => save({ autoMemory: e.target.checked })}
                  />
                  <span>手动分配</span>
                </label>
              </div>
            </div>

            {settings.autoMemory === false && (
              <>
                <div className="settings-row">
                  <div className="settings-row-label">
                    <span>最小内存</span>
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

          <div className="settings-subsection">
            <div className="settings-subsection-title">窗口</div>

            <div className="settings-row">
              <div className="settings-row-label">
                <span>窗口模式</span>
                <span className="settings-row-subtitle">选择启动时的窗口状态</span>
              </div>
              <select
                value={settings.fullscreen ? 'fullscreen' : (settings.width && settings.height ? 'windowed' : 'auto')}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === 'fullscreen') save({ fullscreen: true });
                  else if (v === 'windowed') save({ fullscreen: false, width: 854, height: 480 });
                  else save({ fullscreen: false });
                }}
              >
                <option value="auto">自动 (使用上次设置)</option>
                <option value="windowed">窗口化</option>
                <option value="fullscreen">全屏</option>
              </select>
            </div>

            {!settings.fullscreen && (
              <div className="settings-row">
                <div className="settings-row-label">
                  <span>分辨率</span>
                  <span className="settings-row-subtitle">窗口化时的初始大小</span>
                </div>
                <div className="settings-row-control resolution-input">
<input
                      type="number"
                      value={settings.width ?? 854}
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
                      value={settings.height ?? 480}
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

          <div className="settings-subsection">
            <div className="settings-subsection-title">快速开始</div>

            <div className="settings-row">
              <div className="settings-row-label">
                <span>启动后直接加入</span>
                <span className="settings-row-subtitle">支持服务器地址 (host:port)</span>
              </div>
              <input
                type="text"
                value={settings.server ?? ''}
                placeholder="mc.example.com:25565"
                onChange={(e) => save(e.target.value ? { server: e.target.value } : {})}
              />
            </div>
          </div>

          <div className="settings-subsection">
            <div className="settings-subsection-title">高级启动选项</div>

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
                <span className="settings-row-subtitle">KEY=VALUE;KEY2=VALUE2 (分号或换行分隔)</span>
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
                <span className="settings-row-subtitle">调度优先级 (POSIX)</span>
              </div>
              <select
                value={settings.processPriority ?? 'normal'}
                onChange={(e) => {
                  const val = e.target.value;
                  save({ processPriority: val as InstanceSettingsDto['processPriority'] } as Partial<InstanceSettingsDto>);
                }}
              >
                <option value="normal">标准</option>
                <option value="above_normal">高于标准</option>
                <option value="high">高</option>
                <option value="below_normal">低于标准</option>
                <option value="low">低</option>
              </select>
            </div>
          </div>
        </div>

        <div className="settings-section-card">
          <div className="settings-section-title">高级</div>

          <div className="settings-subsection">
            <div className="settings-subsection-title">JVM</div>

            <div className="settings-row">
              <div className="settings-row-label">
                <span>不使用优化 JVM 参数</span>
                <span className="settings-row-subtitle">禁用 G1GC 调优等自动生成的优化参数</span>
              </div>
              <input
                type="checkbox"
                checked={settings.noOptimizingJVMArgs === true}
                onChange={(e) => save({ noOptimizingJVMArgs: e.target.checked })}
              />
            </div>

            <div className="settings-row">
              <div className="settings-row-label">
                <span>JVM 参数</span>
                <span className="settings-row-subtitle">额外的 JVM 参数 (与全局设置合并)</span>
              </div>
              <input
                type="text"
                value={settings.javaArgs ?? ''}
                placeholder="-Xmx2g -Xms512m -XX:+UseG1GC"
                onChange={(e) => save(e.target.value ? { javaArgs: e.target.value } : {})}
              />
            </div>
          </div>

          <div className="settings-subsection">
            <div className="settings-subsection-title">自定义命令</div>

            <div className="settings-row">
              <div className="settings-row-label">
                <span>包装启动器</span>
                <span className="settings-row-subtitle">启动前的包装命令，如 optirun, primusrun</span>
              </div>
              <input
                type="text"
                value={settings.wrapper ?? ''}
                placeholder="optirun"
                onChange={(e) => save(e.target.value ? { wrapper: e.target.value } : {})}
              />
            </div>
          </div>
        </div>
      </div>
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
  onOpenDetail,
  onCloseDetail
}: {
  state: StateHook;
  detail: ModrinthProjectDto | undefined;
  onOpenDetail: (project: ModrinthProjectDto) => void;
  onCloseDetail: () => void;
}): React.JSX.Element {
  const [tab, setTab] = useState<DlTab>('game');
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
          <AddonTab state={state} type={tab} onOpenDetail={onOpenDetail} />
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

/**
 * Groups addon versions the way HMCL's DownloadPage skin does: an optional
 * 「推荐」 list for the current instance's game version, then per-Minecraft
 * sublists with releases first and snapshots after.
 */
function buildVersionGroups(
  versions: ModrinthVersionDto[],
  remote: RemoteVersionDto[],
  currentInstanceGameVersion: string | undefined
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

  // Versions supporting the current instance's Minecraft version → 推荐.
  const groups: AddonVersionGroup[] = [];
  if (currentInstanceGameVersion !== undefined) {
    const recommended = versions
      .filter((entry) => entry.gameVersions.includes(currentInstanceGameVersion))
      .sort((a, b) => (b.datePublished ?? '').localeCompare(a.datePublished ?? ''));
    if (recommended.length > 0) {
      groups.push({ title: `推荐 (${currentInstanceGameVersion})`, recommend: true, items: recommended });
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

  const byDate = (a: ModrinthVersionDto, b: ModrinthVersionDto): number =>
    (b.datePublished ?? '').localeCompare(a.datePublished ?? '');
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
  onClose,
  onInstallModpack
}: {
  state: StateHook;
  project: ModrinthProjectDto;
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

  const currentInstance = state.installed.find((entry) => entry.id === state.currentId);
  const groups = useMemo(
    () => (versions === undefined ? [] : buildVersionGroups(versions, remote, currentInstance?.jar)),
    [versions, remote, currentInstance?.jar]
  );

  return (
    <div className="addon-detail">
      {selected !== undefined && (
        <AddonVersionDialog
          state={state}
          project={project}
          version={selected}
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
 * Version dialog mirroring `ui/instances/DownloadPage.AddonVersion`: changelog,
 * official page, dependencies and the 安装/另存为/取消 action bar.
 */
function AddonVersionDialog({
  state,
  project,
  version,
  onClose,
  onInstallModpack
}: {
  state: StateHook;
  project: ModrinthProjectDto;
  version: ModrinthVersionDto;
  onClose: () => void;
  onInstallModpack: (version: ModrinthVersionDto) => void;
}): React.JSX.Element {
  const { toast, showToast } = useToast();
  const isModpack = project.projectType === 'modpack';
  const primary = version.files.find((file) => file.primary) ?? version.files[0];

  const installIntoInstance = (): void => {
    if (state.currentId === undefined) {
      showToast('请先在首页创建或选择一个实例');
      return;
    }
    const subdir = subdirForAddon(project.projectType as DlAddonKind);
    onClose();
    hmcl()
      .downloadAddonFile(state.currentId, subdir, version)
      .catch((reason: unknown) => {
        state.appendLog({ text: String(reason), isError: true });
        showToast('安装失败，请查看日志');
      });
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
        </div>
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
            <button className="raised-button" onClick={installIntoInstance}>
              安装
            </button>
          )}
          <button className="raised-button" onClick={saveAs} disabled={primary === undefined}>
            另存为
          </button>
          <button className="text-button" onClick={onClose}>
            取消
          </button>
        </div>
      </div>
      {toast !== undefined && <div className="toast">{toast}</div>}
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

/** Transient toast helper mirroring existing in-page notification behavior. */
function useToast(): { toast: string | undefined; showToast: (message: string) => void } {
  const [toast, setToast] = useState<string | undefined>(undefined);
  const timer = useRef<number | undefined>(undefined);
  const showToast = (message: string): void => {
    setToast(message);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToast(undefined), 2500);
  };
  return { toast, showToast };
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

/** The HMCL-style search card: two field rows plus a pager/action row. */
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
instanceId,
  onInstanceIdChange,
  instances
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
  instanceId: string | undefined;
  onInstanceIdChange?: (value: string | undefined) => void;
  instances?: readonly InstalledVersionDto[];
}): React.JSX.Element {
  // HMCL uses a static list of GA releases (GameVersionNumber.getDefaultGameVersions)
  // We approximate by filtering remote versions to releases only
  const defaultGameVersions = gameVersions.filter(v => /^\d+(\.\d+){1,2}$/.test(v));

  return (
    <div className="search-card card">
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
        {instances && instances.length > 0 && (
          <label className="search-field">
            <span>安装到实例</span>
            <select
              value={instanceId ?? ''}
              onChange={(event) => onInstanceIdChange?.(event.target.value || undefined)}
            >
              <option value="">默认实例</option>
              {instances.map((inst) => (
                <option key={inst.id} value={inst.id}>
                  {inst.id}
                </option>
              ))}
            </select>
          </label>
        )}
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
  onOpenDetail
}: {
  state: StateHook;
  type: DlAddonKind;
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
        if (gameVersion !== '') payload.gameVersion = gameVersion;
        if (category !== '') payload.categories = [category];
        const page = await hmcl().searchModrinthProjects(payload);
        setOffset(nextOffset);
        setResult(page);
      } catch {
        setFailed(true);
      }
    },
    [type, query, gameVersion, category, order]
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
        instanceId={state.currentId}
        onInstanceIdChange={(id) => id && state.setCurrentId(id)}
        instances={state.installed}
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
        instanceId={state.currentId}
        onInstanceIdChange={(id) => id && state.setCurrentId(id)}
        instances={state.installed}
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
  onClose
}: {
  state: StateHook;
  project?: ModrinthProjectDto;
  version?: ModrinthVersionDto;
  localPath?: string;
  onClose?: () => void;
}): React.JSX.Element {
  const defaultName = useMemo(() => {
    if (project !== undefined) return sanitizeInstanceName(project.title);
    if (localPath !== undefined) return instanceNameFromPath(localPath);
    return '安装整合包';
  }, [project, localPath]);

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

  const packName = inspect?.name ?? project?.title ?? '未知整合包';
  const packVersion = inspect?.version ?? (version !== undefined ? version.versionNumber : '');
  const packAuthor = inspect?.author ?? project?.author ?? '';
  const description =
    localPath !== undefined ? (inspect?.summary ?? '') : (project?.description ?? '');

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
        project !== undefined && version !== undefined
          ? await hmcl().installModrinthModpack(project.slug, version.id, name)
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

function formatMiB(mib: number): string {
  if (mib >= 1024) return `${(mib / 1024).toFixed(1)} GiB`;
  return `${Math.round(mib)} MiB`;
}

/** Global download progress footer shown while any download is active. */
function DownloadFooter({
  progress,
  stage
}: {
  progress: DownloadProgressDto;
  stage: string;
}): React.JSX.Element {
  const percent =
    progress.totalBytes !== undefined && progress.totalBytes > 0
      ? Math.min(100, Math.round((progress.downloadedBytes / progress.totalBytes) * 100))
      : progress.total > 0
        ? Math.min(100, Math.round((progress.completed / progress.total) * 100))
        : 0;

  return (
    <div className="dl-footer">
      <div className="dl-footer-top">
        <span className="dl-footer-stage">{stage}</span>
        <span className="dl-footer-files">
          {progress.completed}/{progress.total} 文件
        </span>
      </div>
      <div className="dl-progress">
        <div className="dl-progress-fill" style={{ width: `${percent}%` }} />
      </div>
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

/** Page header shown on top of each settings tab: title plus a short hint. */
function SettingsTabHeader({ title, subtitle }: { title: string; subtitle: string }): React.JSX.Element {
  return (
    <header className="settings-header">
      <h2 className="page-title">{title}</h2>
      <p className="settings-subtitle">{subtitle}</p>
    </header>
  );
}

/** HMCL keeps a repository of Minecraft versions, managed in this tab. */
function GameSettingsTab({ state }: StateHookProps): React.JSX.Element {
  const save = makeSettingsSave(state);
  return (
    <div className="settings-scroll">
      <SettingsTabHeader title="版本管理" subtitle="管理游戏版本、内存分配与游戏目录。" />
      <div className="component-title">基础</div>
      <div className="card settings-card">
        <div className="card-title">内存</div>
        <label className="field">
          <span>最大内存（MiB）</span>
          <input
            type="number"
            defaultValue={state.settings.maxMemory ?? 4096}
            onBlur={(event) => save({ maxMemory: Number(event.target.value) || undefined })}
          />
        </label>
      </div>
      <div className="component-title">游戏</div>
      <div className="card settings-card">
        <div className="card-title">游戏目录</div>
        <div className="field">
          <span>当前游戏目录</span>
          <code>{state.settings.gameDir}</code>
        </div>
      </div>
    </div>
  );
}

/** Java runtime detection and selection, mirroring HMCL's Java 管理 tab. */
function JavaSettingsTab({ state }: StateHookProps): React.JSX.Element {
  const save = makeSettingsSave(state);
  const [detectedJavas, setDetectedJavas] = useState<JavaRuntimeDto[]>([]);
  const [customJavaPath, setCustomJavaPath] = useState('');
  const [useCustomJava, setUseCustomJava] = useState(false);

  const detectJava = async (): Promise<void> => {
    const runtimes = await hmcl().detectJava();
    setDetectedJavas(runtimes);
  };

  const pickCustomJava = async (): Promise<void> => {
    const path = await hmcl().pickJavaExecutable();
    if (path !== undefined) {
      setCustomJavaPath(path);
      save({ javaExecutable: path });
    }
  };

  useEffect(() => {
    detectJava();
  }, []);

  return (
    <div className="settings-scroll">
      <SettingsTabHeader title="Java 管理" subtitle="检测并选择用于启动游戏的 Java 运行时。" />
      
      <div className="component-title">运行时选择</div>
      <div className="card settings-card">
        <div className="card-title">Java 运行时</div>
        
        <label className="field field-row">
          <input
            type="radio"
            name="java-mode"
            checked={!state.settings.javaExecutable}
            onChange={() => save({ javaExecutable: undefined })}
          />
          <span>自动检测 (推荐)</span>
        </label>
        
        <label className="field field-row">
          <input
            type="radio"
            name="java-mode"
            checked={!!state.settings.javaExecutable}
            onChange={() => {}}
          />
          <span>指定 Java 路径</span>
        </label>

        {state.settings.javaExecutable && (
          <div className="field field-row">
            <input
              type="text"
              value={state.settings.javaExecutable}
              placeholder="选择 Java 可执行文件路径"
              readOnly
            />
            <button className="border-button" onClick={async () => {
              const path = await hmcl().pickJavaExecutable();
              if (path) save({ javaExecutable: path });
            }}>
              浏览…
            </button>
          </div>
        )}

        <div className="field">
          <span>已检测到的 Java 运行时</span>
          <button className="text-button" onClick={async () => {
            const runtimes = await hmcl().detectJava();
            // refresh handled by main process
          }}>
            重新检测
          </button>
        </div>
        <ul className="java-list">
          {state.javas.map((java) => (
            <li
              key={java.executable}
              className={java.executable === state.settings.javaExecutable ? 'selected' : ''}
              onClick={() => save({ javaExecutable: java.executable })}
            >
              Java {java.versionString}
              <code>{java.executable}</code>
            </li>
          ))}
          {state.javas.length === 0 && <li className="empty">未检测到 Java，点击重新检测</li>}
        </ul>
      </div>
    </div>
  );
}

/** Launcher-wide behavior: update channel, April Fools and log export. */
function GeneralSettingsTab({ state }: StateHookProps): React.JSX.Element {
  const save = makeSettingsSave(state);
  const exportLogs = async (): Promise<void> => {
    try {
      const text =
        state.logs.map((line) => line.text).join('\n') || '（本启动器会话暂无日志）';
      const target = await hmcl().exportLogs(text);
      state.appendLog({ text: `日志已导出: ${target}`, isError: false });
    } catch (error) {
      state.appendLog({ text: `导出日志失败: ${String(error)}`, isError: true });
    }
  };
  return (
    <div className="settings-scroll">
      <SettingsTabHeader title="常规" subtitle="更新、杂项与调试选项。" />
      <div className="component-title">更新</div>
      <div className="card settings-card">
        <div className="card-title">更新推送</div>
        <div className="field">
          <span>更新频道</span>
          <select
            value={state.settings.updateChannel ?? 'stable'}
            onChange={(event) =>
              save({ updateChannel: event.target.value === 'stable' ? undefined : 'dev' })
            }
          >
            <option value="stable">稳定版</option>
            <option value="dev">开发版</option>
          </select>
        </div>
      </div>
      <div className="component-title">杂项</div>
      <div className="card settings-card">
        <div className="card-title">杂项设置</div>
        <label className="field field-row">
          <input
            type="checkbox"
            checked={state.settings.aprilFools ?? false}
            onChange={(event) => save({ aprilFools: event.target.checked })}
          />
          <span>愚人节彩蛋</span>
        </label>
        <label className="field">
          <span>默认玩家名（离线登录）</span>
          <input
            defaultValue={state.settings.playerName}
            onBlur={(event) => save({ playerName: event.target.value })}
          />
        </label>
      </div>
      <div className="component-title">语言</div>
      <div className="card settings-card">
        <div className="card-title">语言</div>
        <label className="field">
          <span>界面语言</span>
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
        </label>
      </div>
      <div className="component-title">调试</div>
      <div className="card settings-card">
        <div className="card-title">启动器日志</div>
        <div className="field">
          <span>导出当前会话日志</span>
          <button className="text-button" onClick={() => void exportLogs()}>
            导出日志
          </button>
        </div>
      </div>
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
  return (
    <div className="settings-scroll">
      <SettingsTabHeader title="个性化" subtitle="定制启动器外观与主题。" />
      <div className="component-title">主题</div>
      <div className="card settings-card">
        <div className="card-title">主题色</div>
        <div className="field field-row">
          <span>主色调</span>
          <input
            type="color"
            className="color-input"
            value={state.settings.themeColor ?? DEFAULT_THEME_COLOR}
            onChange={(event) => save({ themeColor: event.target.value })}
          />
          <button
            className="text-button"
            disabled={state.settings.themeColor === undefined}
            onClick={() => save({ themeColor: undefined })}
          >
            恢复默认
          </button>
        </div>
      </div>
      <div className="component-title">背景</div>
      <div className="card settings-card">
        <div className="card-title">启动器背景</div>
        <div className="field field-row">
          <span>背景图</span>
          <button className="text-button" onClick={() => void pickBackground()}>
            选择背景图…
          </button>
          <button
            className="text-button"
            disabled={!state.settings.themeBackground}
            onClick={() => save({ themeBackground: undefined })}
          >
            移除背景图
          </button>
        </div>
      </div>
      <div className="component-title">透明</div>
      <div className="card settings-card">
        <div className="card-title">透明背景</div>
        <label className="field field-row">
          <input
            type="checkbox"
            checked={state.settings.launcherBackgroundTransparent ?? false}
            onChange={(event) =>
              save({ launcherBackgroundTransparent: event.target.checked })
            }
          />
          <span>启用透明背景</span>
        </label>
        <div className="field field-row">
          <span>若透明背景未生效</span>
          <button
            className="text-button"
            disabled={!(state.settings.launcherBackgroundTransparent ?? false)}
            onClick={() =>
              void hmcl()
                .fixBackgroundTransparency()
                .then(() =>
                  state.appendLog({ text: '已重新应用透明背景', isError: false })
                )
                .catch((error) =>
                  state.appendLog({ text: `修复透明背景失败: ${String(error)}`, isError: true })
                )
            }
          >
            尝试修复
          </button>
        </div>
        <p className="notice-text">
          Linux 下透明背景需要桌面合成器（Compositor）支持；Windows 若仍不生效请尝试「尝试修复」。
        </p>
      </div>
    </div>
  );
}

/** Download settings mirroring HMCL's DownloadSettingsPage. */
function DownloadSettingsTab({ state }: StateHookProps): React.JSX.Element {
  const save = makeSettingsSave(state);
  const [detectedJavas, setDetectedJavas] = useState<JavaRuntimeDto[]>([]);

  const detectJava = async (): Promise<void> => {
    const runtimes = await hmcl().detectJava();
    setDetectedJavas(runtimes);
  };

  useEffect(() => {
    detectJava();
  }, []);

  return (
    <div className="settings-scroll">
      <SettingsTabHeader title="下载" subtitle="下载源、缓存目录与代理设置。" />

      <div className="component-title">下载源</div>
      <div className="card settings-card">
        <div className="card-title">下载镜像</div>
        <div className="field">
          <span>版本列表源</span>
          <select
            value={state.settings.downloadMirror}
            onChange={(event) =>
              save({ downloadMirror: event.target.value as SettingsDto['downloadMirror'] })
            }
          >
            <option value="bmclapi">BMCLAPI（国内推荐）</option>
            <option value="mojang">Mojang 官方源</option>
          </select>
        </div>
        <div className="field">
          <span>文件下载源</span>
          <select
            value={state.settings.fileDownloadSource ?? 'bmclapi'}
            onChange={(event) =>
              save({ fileDownloadSource: event.target.value as SettingsDto['fileDownloadSource'] })
            }
          >
            <option value="bmclapi">BMCLAPI（国内推荐）</option>
            <option value="mojang">Mojang 官方源</option>
          </select>
        </div>
        <div className="field">
          <span>默认附加组件源</span>
          <select
            value={state.settings.defaultAddonSource ?? 'modrinth'}
            onChange={(event) =>
              save({ defaultAddonSource: event.target.value as SettingsDto['defaultAddonSource'] })
            }
          >
            <option value="modrinth">Modrinth</option>
            <option value="curseforge">CurseForge</option>
          </select>
        </div>
      </div>

      <div className="component-title">缓存目录</div>
      <div className="card settings-card">
        <div className="card-title">缓存目录</div>
        <div className="field field-row">
          <span>缓存目录</span>
          <code>{state.settings.commonDirectory ?? '默认'}</code>
        </div>
        <div className="field field-row">
          <button className="text-button" onClick={async () => {
            const path = await hmcl().pickThemeBackground(); // reuse
            if (path) save({ commonDirectory: path });
          }}>
            选择目录…
          </button>
        </div>
      </div>

      <div className="component-title">下载线程</div>
      <div className="card settings-card">
        <div className="card-title">并发下载线程数</div>
        <label className="field field-row">
          <input
            type="radio"
            name="threads-mode"
            checked={state.settings.autoDownloadThreads !== false}
            onChange={(e) => save({ autoDownloadThreads: e.target.checked })}
          />
          <span>自动 (根据系统决定)</span>
        </label>
        <label className="field field-row">
          <input
            type="radio"
            name="threads-mode"
            checked={state.settings.autoDownloadThreads === false}
            onChange={() => {}}
          />
          <span>自定义</span>
        </label>
        {state.settings.autoDownloadThreads === false && (
          <div className="field field-row">
            <input
              type="range"
              min={1}
              max={256}
              value={state.settings.downloadThreads ?? 64}
              onChange={(e) => save({ downloadThreads: Number(e.target.value) })}
            />
            <span className="slider-value">{state.settings.downloadThreads ?? 64}</span>
          </div>
        )}
        <div className="field field-row">
          <button className="text-button" onClick={async () => {
            const path = await hmcl().pickThemeBackground(); // reuse
            if (path) save({ commonDirectory: path });
          }}>
            清理缓存
          </button>
        </div>
      </div>

      <div className="component-title">代理设置</div>
      <div className="card settings-card">
        <div className="card-title">代理服务器</div>
        <label className="field field-row">
          <input
            type="checkbox"
            checked={state.settings.useProxy ?? false}
            onChange={(e) => save({ useProxy: e.target.checked })}
          />
          <span>使用代理</span>
        </label>
        {state.settings.useProxy && (
          <div className="field field-row">
            <span>地址</span>
            <input
              type="text"
              value={state.settings.proxyHost ?? ''}
              placeholder="127.0.0.1"
              onChange={(e) => save({ proxyHost: e.target.value })}
            />
            <span>:</span>
            <input
              type="number"
              value={state.settings.proxyPort ?? 7890}
              min={1}
              max={65535}
              onChange={(e) => save({ proxyPort: Number(e.target.value) })}
            />
          </div>
        )}
        <div className="field field-row">
          <span>类型</span>
          <select
            value={state.settings.proxyType ?? 'http'}
            onChange={(e) => save({ proxyType: e.target.value as SettingsDto['proxyType'] })}
          >
            <option value="http">HTTP</option>
            <option value="socks5">SOCKS5</option>
          </select>
        </div>
        <label className="field field-row">
          <input
            type="checkbox"
            checked={state.settings.proxyAuth ?? false}
            onChange={(e) => save({ proxyAuth: e.target.checked })}
          />
          <span>需要认证</span>
        </label>
        {state.settings.proxyAuth && (
          <div className="field field-row">
            <span>用户名</span>
            <input
              type="text"
              value={state.settings.proxyUsername ?? ''}
              onChange={(e) => save({ proxyUsername: e.target.value })}
            />
          </div>
        )}
        {state.settings.proxyAuth && (
          <div className="field field-row">
            <span>密码</span>
            <input
              type="password"
              value={state.settings.proxyPassword ?? ''}
              onChange={(e) => save({ proxyPassword: e.target.value })}
            />
          </div>
        )}
      </div>
    </div>
  );
}

/** Terse help links for launcher newcomers. */
function HelpSettingsTab(): React.JSX.Element {
  return (
    <div className="settings-scroll">
      <SettingsTabHeader title="帮助" subtitle="相关文档与资源。" />
      <div className="component-title">文档</div>
      <div className="card settings-card">
        <div className="card-title">相关资源</div>
        <button
          className="text-button"
          onClick={() => void hmcl().openExternal('https://hmcl.huangyuhui.net/help/')}
        >
          HMCL 官方文档
        </button>
        <button
          className="text-button"
          onClick={() => void hmcl().openExternal('https://github.com/HMCL-dev/HMCL')}
        >
          GitHub 项目主页
        </button>
      </div>
    </div>
  );
}

/** Feedback entry pointing at the upstream issue tracker. */
function FeedbackSettingsTab(): React.JSX.Element {
  return (
    <div className="settings-scroll">
      <SettingsTabHeader title="联系" subtitle="反馈与建议。" />
      <div className="component-title">反馈</div>
      <div className="card settings-card">
        <div className="card-title">意见与建议</div>
        <p className="notice-text">
          本重写版与上游 HMCL 共用同一个反馈渠道，欢迎前往 GitHub Issues 提交问题。
        </p>
        <button
          className="text-button"
          onClick={() => void hmcl().openExternal('https://github.com/HMCL-dev/HMCL/issues')}
        >
          前往 GitHub Issues
        </button>
      </div>
    </div>
  );
}

/** About page: version, license and upstream credit. */
function AboutSettingsTab(): React.JSX.Element {
  return (
    <div className="settings-scroll">
      <SettingsTabHeader title="关于" subtitle="版本信息与致谢。" />
      <div className="component-title">启动器</div>
      <div className="card settings-card">
        <div className="card-title">HMCL Rewrite {REWRITE_VERSION}</div>
        <p className="notice-text">
          这是 Hello Minecraft! Launcher（HMCL）的 TypeScript / Electron 重写版，
          界面与交互尽力对齐原版（GPL-3.0）。
        </p>
        <button
          className="text-button"
          onClick={() => void hmcl().openExternal(HMCL_RELEASES_URL)}
        >
          原版 HMCL 最新版本
        </button>
      </div>
    </div>
  );
}

/** Settings page mirroring HMCL's LauncherSettingsPage (8 tabs, sidebar navigation). */
function SettingsPage({ state }: StateHookProps): React.JSX.Element {
  const [tab, setTab] = useState<SettingsTab>('game');

  const groups: { category: string; items: { id: SettingsTab; label: string; icon: React.JSX.Element }[] }[] = [
    {
      category: '实例',
      items: [
        { id: 'game', label: '游戏设置', icon: <GamepadIcon size={20} /> },
        { id: 'java', label: 'Java 管理', icon: <CoffeeIcon size={20} /> }
      ]
    },
    {
      category: '启动器',
      items: [
        { id: 'general', label: '常规', icon: <SettingsIcon size={20} /> },
        { id: 'appearance', label: '个性化', icon: <PaletteIcon size={20} /> },
        { id: 'download', label: '下载', icon: <DownloadIcon size={20} /> }
      ]
    },
    {
      category: '帮助',
      items: [
        { id: 'help', label: '帮助', icon: <WikiIcon size={20} /> },
        { id: 'feedback', label: '联系', icon: <PublicIcon size={20} /> },
        { id: 'about', label: '关于', icon: <InfoIcon size={20} /> }
      ]
    }
  ];

  return (
    <div className="settings-page">
      <aside className="dl-sidebar">
        {groups.map((group) => (
          <div key={group.category}>
            <div className="sidebar-category">{group.category}</div>
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

/** Bottom drawer streaming game output, replacing HMCL's log window. */
function LogDrawer({ state, onClose }: StateHookProps & { onClose: () => void }): React.JSX.Element {
  return (
    <div className="log-drawer">
      <div className="log-header">
        <span>游戏日志</span>
        <button className="text-button" onClick={onClose}>
          关闭
        </button>
      </div>
      <pre className="log-body">
        {state.logs.map((line, index) => (
          <div key={index} className={line.isError ? 'err' : ''}>
            {line.text}
          </div>
        ))}
      </pre>
    </div>
  );
}

export function App(): React.JSX.Element {
  return <Shell />;
}
