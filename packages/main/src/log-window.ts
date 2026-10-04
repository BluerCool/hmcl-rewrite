/**
 * The log window and the buffer behind it.
 *
 * HMCL keeps the session log in a `CircularArrayList` owned by the launcher and
 * hands that same list to every `LogWindow`, so closing the window never loses
 * the log (LauncherHelper.java:857). Here the buffer lives in main and the window
 * is a second `BrowserWindow` that renders a snapshot plus the live tail, which
 * is the closest equivalent without a second JavaFX stage.
 */
import { BrowserWindow } from 'electron';
import { join } from 'node:path';
import { parseLogLevel } from '@hmcl/core';
import type { LogLineDto, LogSnapshotDto } from '@hmcl/shared';

/** HMCL's window background for the log window (root.css brightness-dark:10). */
const LOG_WINDOW_BACKGROUND = '#282828';

/** Rows kept before the oldest is dropped, matching HMCL's default (Log.java:25). */
const DEFAULT_LOG_LINES = 2000;

/** A row as it arrives from the launch pipeline or the launcher itself. */
export interface OutputRow {
  launchId: number;
  line: string;
  isError: boolean;
  level: LogLineDto['level'];
}

export class LogWindowController {
  private lines: LogLineDto[] = [];
  private nextSeq = 1;
  private win: BrowserWindow | null = null;
  private alwaysOnTop = false;
  private limit = DEFAULT_LOG_LINES;

  constructor(
    /** Sends an event to every window; the log window picks its rows out of it. */
    private readonly broadcast: (event: unknown) => void,
    /** Launch id of the game currently up, or undefined when none is. */
    private readonly runningLaunchId: () => number | undefined
  ) {}

  /** Changes how many rows are kept, trimming the buffer right away. */
  setLimit(count: number): void {
    this.limit = count > 0 ? count : DEFAULT_LOG_LINES;
    this.trim();
  }

  /**
   * Files one row and hands it back with its sequence number, so the caller can
   * broadcast the same identity the log window dedupes on.
   */
  record(row: OutputRow): LogLineDto {
    const filed: LogLineDto = {
      text: row.line,
      isError: row.isError,
      level: row.level,
      time: Date.now(),
      seq: this.nextSeq++
    };
    this.lines.push(filed);
    this.trim();
    return filed;
  }

  /**
   * Publishes one row on the same channel as game output, so it lands in the log
   * window and in the exported file like any other line. `level` is recovered
   * from the text when the caller has no better idea.
   */
  publish(launchId: number, line: string, isError: boolean, level?: LogLineDto['level']): void {
    this.broadcast({
      kind: 'output',
      launchId,
      line,
      isError,
      level: level ?? parseLogLevel(line, isError) ?? 'info'
    });
  }

  snapshot(): LogSnapshotDto {
    return { lines: this.lines, runningLaunchId: this.runningLaunchId() };
  }

  clear(): void {
    this.lines = [];
  }

  /** Creates the window, or focuses the one already showing. */
  open(): void {
    if (this.win !== null && !this.win.isDestroyed()) {
      this.win.show();
      this.win.focus();
      return;
    }
    this.win = new BrowserWindow({
      width: 800,
      height: 480,
      minWidth: 520,
      minHeight: 240,
      title: '日志',
      backgroundColor: LOG_WINDOW_BACKGROUND,
      autoHideMenuBar: true,
      webPreferences: {
        // Same preload as the launcher window: the log window uses the same API.
        preload: join(__dirname, '../preload/index.mjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
      }
    });
    if (this.alwaysOnTop) this.win.setAlwaysOnTop(true);
    // Closing only destroys the view; the buffer is main's and stays put.
    this.win.on('closed', () => {
      this.win = null;
    });

    const devServer = process.env.ELECTRON_RENDERER_URL;
    if (devServer !== undefined) {
      void this.win.loadURL(`${devServer}log.html`);
    } else {
      void this.win.loadFile(join(__dirname, '../renderer/log.html'));
    }
    // Sent once the page can listen, which fills the window with the session so
    // far without replaying thousands of events through the event channel.
    this.win.webContents.once('did-finish-load', () => {
      this.win?.webContents.send('hmcl:event', { kind: 'log-snapshot', snapshot: this.snapshot() });
    });
  }

  setAlwaysOnTop(alwaysOnTop: boolean): void {
    this.alwaysOnTop = alwaysOnTop;
    if (this.win !== null && !this.win.isDestroyed()) this.win.setAlwaysOnTop(alwaysOnTop);
  }

  /** Whether the window is up, so the renderer can keep its toggle in sync. */
  isOpen(): boolean {
    return this.win !== null && !this.win.isDestroyed();
  }

  private trim(): void {
    if (this.lines.length > this.limit) this.lines = this.lines.slice(-this.limit);
  }
}