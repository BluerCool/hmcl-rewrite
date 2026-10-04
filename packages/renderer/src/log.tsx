/**
 * The separate log window — HMCL's `LogWindow` as a second page.
 *
 * The buffer lives in the main process (see `main/src/log-window.ts`), the way
 * HMCL keeps one `CircularArrayList` in the launcher and shares it with every
 * log window, so this window can be closed and reopened without losing anything.
 * Rows arrive two ways: a snapshot sent once the page has loaded, and live
 * `output` events after that. The snapshot's highest sequence number tells the
 * window which live rows it already contains, so nothing is lost or doubled no
 * matter how the two channels interleave.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import type { LogLevel, LogLineDto } from '@hmcl/shared';
import { hmcl } from './bridge';
import { PushPinIcon } from './icons';
import './log.css';

/** Row caps offered by the top bar, matching HMCL's combo (LogWindow.java:192). */
const ROW_CAPS = [500, 2000, 5000, 10000];
/** HMCL's own default when `logLines` is unset (Log.DEFAULT_LOG_LINES). */
const DEFAULT_ROW_CAP = 2000;

/**
 * Level order and labels. HMCL labels these rows "3 errors" in every locale
 * (LogWindow.java:197); this window is Chinese throughout, so it counts them in
 * Chinese instead of leaving an English word in the middle of the toolbar.
 */
const LEVELS: readonly { level: LogLevel; label: string }[] = [
  { level: 'fatal', label: '致命' },
  { level: 'error', label: '错误' },
  { level: 'warn', label: '警告' },
  { level: 'info', label: '信息' },
  { level: 'debug', label: '调试' },
  { level: 'trace', label: '追踪' }
];

/**
 * Holds what the window renders. `useSyncExternalStore` compares snapshots by
 * identity, so the snapshot object is rebuilt only when something actually
 * changes rather than on every call.
 */
interface Store {
  subscribe(listener: () => void): () => void;
  get(): Snapshot;
  update(patch: Partial<Snapshot>): void;
}

interface Snapshot {
  lines: LogLineDto[];
  runningLaunchId: number | undefined;
  snapshotReceived: boolean;
}

function createStore(): Store {
  const listeners = new Set<() => void>();
  let snapshot: Snapshot = { lines: [], runningLaunchId: undefined, snapshotReceived: false };
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    get: () => snapshot,
    update(patch) {
      snapshot = { ...snapshot, ...patch };
      for (const listener of listeners) listener();
    }
  };
}

const store = createStore();

/** Highest sequence number currently held, so live rows can be filtered. */
function highestSeq(lines: LogLineDto[]): number {
  let highest = 0;
  for (const line of lines) if (line.seq > highest) highest = line.seq;
  return highest;
}

/**
 * Subscribed at module scope rather than from an effect: main sends the snapshot
 * as soon as the page finishes loading, which can beat React's first effect.
 */
hmcl().onEvent((event) => {
  switch (event.kind) {
    case 'log-snapshot':
      store.update({
        lines: event.snapshot.lines,
        runningLaunchId: event.snapshot.runningLaunchId,
        snapshotReceived: true
      });
      break;
    case 'output': {
      // Until the snapshot lands, rows are held back: it may already contain
      // them. Once it has, anything at or below its high-water mark is a repeat.
      if (!store.get().snapshotReceived || event.seq <= highestSeq(store.get().lines)) break;
      const row: LogLineDto = {
        text: event.line,
        isError: event.isError,
        level: event.level,
        time: event.time,
        seq: event.seq
      };
      store.update({ lines: [...store.get().lines, row] });
      break;
    }
    case 'log-cleared':
      store.update({ lines: [] });
      break;
    case 'exit':
      // Main clears the running game before broadcasting the exit, so the
      // terminate button can go dead on this event alone.
      store.update({ runningLaunchId: undefined });
      break;
    case 'stage':
      if (event.stage !== 'running') break;
      // The window was already open when this launch started, so no snapshot is
      // coming; ask which launch is up instead.
      void hmcl()
        .getLogSnapshot()
        .then((snapshot) => store.update({ runningLaunchId: snapshot.runningLaunchId }))
        .catch(() => undefined);
      break;
    default:
      break;
  }
});

function LogWindow(): React.JSX.Element {
  const { lines, runningLaunchId, snapshotReceived } = useSyncExternalStore(store.subscribe, store.get);
  const rowsRef = useRef<HTMLDivElement>(null);
  /** HMCL `logwindow.autoscroll` and `logwindow.wrap_text`, both on by default. */
  const [autoScroll, setAutoScroll] = useState(true);
  const [wrapText, setWrapText] = useState(true);
  const [alwaysOnTop, setAlwaysOnTop] = useState(false);
  const [rowCap, setRowCap] = useState(DEFAULT_ROW_CAP);
  const [hidden, setHidden] = useState<ReadonlySet<LogLevel>>(new Set());
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const [busy, setBusy] = useState(false);
  /**
   * Whether the view sits on the newest row. Scrolling up pauses the follow so
   * a wall of new output cannot drag the reader away from the line they just
   * scrolled back to; the tail button brings them back.
   */
  const [atTail, setAtTail] = useState(true);
  const follow = autoScroll && atTail;

  useEffect(() => {
    void hmcl()
      .getSettings()
      .then((settings) => setRowCap(settings.logLines ?? DEFAULT_ROW_CAP))
      .catch(() => undefined);
  }, []);

  // Counts cover the whole buffer, not the filtered view, so a level stays
  // discoverable while it is switched off (LogWindow.java:115-116).
  const counts = useMemo(() => {
    const tally = new Map<LogLevel, number>();
    for (const line of lines) tally.set(line.level, (tally.get(line.level) ?? 0) + 1);
    return tally;
  }, [lines]);

  const shown = useMemo(() => lines.filter((line) => !hidden.has(line.level)), [lines, hidden]);

  useEffect(() => {
    if (!follow) return;
    const rows = rowsRef.current;
    if (rows !== null) rows.scrollTop = rows.scrollHeight;
  }, [shown.length, follow]);

  const onScroll = useCallback((): void => {
    const rows = rowsRef.current;
    if (rows === null) return;
    setAtTail(rows.scrollHeight - rows.scrollTop - rows.clientHeight <= 8);
  }, []);

  const jumpToTail = (): void => {
    setAtTail(true);
    const rows = rowsRef.current;
    if (rows !== null) rows.scrollTop = rows.scrollHeight;
  };

  /** Click selects one row; ctrl/cmd-click extends the selection. */
  const toggleSelected = (seq: number, additive: boolean): void => {
    setSelected((previous) => {
      const next = new Set(additive ? previous : []);
      if (previous.has(seq) && additive) next.delete(seq);
      else next.add(seq);
      return next;
    });
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'c') return;
      if (selected.size === 0) return;
      const text = shown
        .filter((line) => selected.has(line.seq))
        .map((line) => line.text)
        .join('\n');
      void navigator.clipboard.writeText(`${text}\n`);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, shown]);

  /** Runs a log action, showing its own failure as an error row. */
  const run = async (what: string, action: () => Promise<string>): Promise<void> => {
    setBusy(true);
    try {
      const target = await action();
      void hmcl().appendLog({ text: `${what}: ${target}`, isError: false });
    } catch (error) {
      void hmcl().appendLog({ text: `${what}失败: ${String(error)}`, isError: true });
    } finally {
      setBusy(false);
    }
  };

  const toggleLevel = (level: LogLevel): void => {
    setHidden((previous) => {
      const next = new Set(previous);
      if (next.has(level)) next.delete(level);
      else next.add(level);
      return next;
    });
  };

  return (
    <div className="log-window">
      <div className="log-top">
        <div className="log-top-left">
          <button
            className={`icon-toggle${alwaysOnTop ? ' on' : ''}`}
            title="置顶窗口"
            aria-label="置顶窗口"
            aria-pressed={alwaysOnTop}
            onClick={() => {
              const next = !alwaysOnTop;
              setAlwaysOnTop(next);
              void hmcl().setLogAlwaysOnTop(next);
            }}
          >
            <PushPinIcon size={16} />
          </button>
          <label className="field-label">
            显示行数{' '}
            <select
              className="row-cap"
              value={rowCap}
              onChange={(event) => {
                const count = Number(event.target.value);
                setRowCap(count);
                void hmcl().setLogLines(count);
              }}
            >
              {ROW_CAPS.map((count) => (
                <option key={count} value={count}>
                  {count}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="log-top-right">
          {LEVELS.map(({ level, label }) => (
            <button
              key={level}
              className={`level-toggle ${level}${hidden.has(level) ? '' : ' on'}`}
              aria-pressed={!hidden.has(level)}
              title={`${label}（点击${hidden.has(level) ? '显示' : '隐藏'}）`}
              onClick={() => toggleLevel(level)}
            >
              {counts.get(level) ?? 0} {label}
            </button>
          ))}
        </div>
      </div>

      <div
        className={`log-rows${wrapText ? ' wrap' : ''}`}
        ref={rowsRef}
        onScroll={onScroll}
        role="log"
        aria-label="游戏日志"
      >
        {shown.map((line) => (
          <div
            key={line.seq}
            className={`log-row ${line.level}${selected.has(line.seq) ? ' selected' : ''}`}
            onClick={(event) => toggleSelected(line.seq, event.ctrlKey || event.metaKey)}
          >
            {line.text}
          </div>
        ))}
        {shown.length === 0 && (
          <div className="log-empty">{snapshotReceived ? '没有日志' : '正在载入日志…'}</div>
        )}
      </div>

      {!follow && shown.length > 0 && (
        <button className="tail-button" onClick={jumpToTail}>
          回到最新
        </button>
      )}

      <div className="log-bottom">
        <label className="check">
          <input type="checkbox" checked={autoScroll} onChange={(event) => setAutoScroll(event.target.checked)} />
          自动滚动
        </label>
        <label className="check">
          <input type="checkbox" checked={wrapText} onChange={(event) => setWrapText(event.target.checked)} />
          自动换行
        </label>
        <button className="action" disabled={busy} onClick={() => void run('日志已导出', () => hmcl().exportLogs())}>
          导出
        </button>
        <button
          className="action"
          disabled={busy || runningLaunchId === undefined}
          title={runningLaunchId === undefined ? '游戏未在运行' : '结束游戏进程'}
          onClick={() => {
            if (runningLaunchId !== undefined) void hmcl().stopGame(runningLaunchId);
          }}
        >
          结束游戏进程
        </button>
        <button
          className="action"
          disabled={busy || runningLaunchId === undefined}
          title={runningLaunchId === undefined ? '游戏未在运行' : '导出游戏运行栈'}
          onClick={() => void run('运行栈已导出', () => hmcl().dumpGameStack())}
        >
          导出游戏运行栈
        </button>
        <button
          className="action"
          onClick={() => {
            setSelected(new Set());
            void hmcl().clearLogs();
          }}
        >
          清除
        </button>
      </div>
    </div>
  );
}

const container = document.getElementById('log-root');
if (container === null) throw new Error('Missing #log-root element');
createRoot(container).render(<LogWindow />);