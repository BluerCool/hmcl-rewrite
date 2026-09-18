/**
 * Concurrent file downloader with SHA-1 verification, retry and progress
 * reporting — the TypeScript counterpart of HMCL's `FileDownloadTask`.
 *
 * Progress snapshots are emitted while bytes stream (throttled to keep IPC
 * traffic bounded) and carry an estimated `bytesPerSecond` for live UIs.
 */
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, stat, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/** Progress snapshot for a batch of downloads. */
export interface DownloadProgress {
  /** Number of files completed successfully. */
  readonly completed: number;
  /** Total number of files in the batch. */
  readonly total: number;
  /** Bytes downloaded so far across all files. */
  readonly downloadedBytes: number;
  /** Total bytes expected, when known. */
  readonly totalBytes: number | undefined;
  /** Human-readable name of the file currently being processed. */
  readonly currentFile: string | undefined;
  /** Estimated instantaneous download throughput in bytes/second. */
  readonly bytesPerSecond: number;
}

/** Options for a single download entry. */
export interface DownloadEntry {
  /** Primary source URL (already mirror-injected where applicable). */
  readonly url: string;
  /** Destination file path. */
  readonly destination: string;
  /** Expected SHA-1 digest; skips download when the file already matches. */
  readonly sha1?: string | undefined;
  /** Expected size in bytes. */
  readonly size?: number | undefined;
  /** Fallback URLs tried in order after the primary URL fails. */
  readonly altUrls?: readonly string[] | undefined;
}

/** Error thrown when a download fails after all retries. */
export class DownloadError extends Error {
  constructor(
    message: string,
    readonly url: string,
    readonly status?: number
  ) {
    super(message);
    this.name = 'DownloadError';
  }

  /** Whether this error represents a permanent HTTP failure (4xx except 408/429). */
  isPermanent(): boolean {
    return this.status !== undefined && this.status >= 400 && this.status < 500 &&
           this.status !== 408 && this.status !== 429;
  }
}

export interface DownloaderOptions {
  /** Maximum parallel downloads; defaults to 8. */
  concurrency?: number | undefined;
  /** Attempts per URL before moving to the next candidate; defaults to 6. */
  retries?: number | undefined;
  /** Progress callback invoked as the batch advances. */
  onProgress?: ((progress: DownloadProgress) => void) | undefined;
/** Abort signal shared by all downloads in the batch. */
  readonly signal?: AbortSignal | undefined;
  /** Maximum wait for response headers before the attempt is aborted. */
  readonly headerTimeoutMs?: number | undefined;
  /** Maximum time without receiving body bytes before the attempt is aborted. */
  readonly idleTimeoutMs?: number | undefined;
  /** Extra whole-batch passes retried for files that fail; defaults to 3. */
  readonly batchPasses?: number | undefined;
}

/** Mutable state shared between the batch workers and streaming files. */
interface BatchSession {
  completed: number;
  currentFile: string | undefined;
  /** Known total, grown by `content-length` headers when entry sizes miss. */
  totalBytes: number | undefined;
  /** URLs whose `content-length` has already been counted to avoid double-counting on retries. */
  seenDeclaredLengths: Set<string>;
}

/**
 * Downloads a batch of files with bounded concurrency, digest verification
 * and idempotent skipping of already-correct files.
 */
export class Downloader {
  private readonly concurrency: number;
  private readonly retries: number;
  private readonly onProgress: ((progress: DownloadProgress) => void) | undefined;
  private readonly signal: AbortSignal | undefined;
  private readonly headerTimeoutMs: number;
  private readonly idleTimeoutMs: number;
  private readonly batchPasses: number;

  /** Cumulative bytes streamed across all files in the current batch. */
  private downloadedBytes = 0;
  /** Timestamp of the last speed sample (monotonic ms). */
  private lastSampleTime = 0;
  /** `downloadedBytes` at the last speed sample. */
  private lastSampleBytes = 0;
  /** Exponential moving average of the download throughput. */
  private bytesPerSecond = 0;

  constructor(options: DownloaderOptions = {}) {
    this.concurrency = options.concurrency ?? 8;
    this.retries = options.retries ?? 6;
    this.onProgress = options.onProgress;
    this.signal = options.signal;
    this.headerTimeoutMs = options.headerTimeoutMs ?? 40_000;
    this.idleTimeoutMs = options.idleTimeoutMs ?? 30_000;
    this.batchPasses = options.batchPasses ?? 3;
  }

  /**
   * Downloads all entries; files whose SHA-1 already matches are skipped.
   *
   * When a subset of files fails (e.g. a transient network burst), the
   * remaining entries are retried in up to {@link batchPasses} additional
   * passes after a short backoff — mirroring HMCL's resumable install tasks.
   *
   * @throws DownloadError when files still fail after all passes
   */
  async downloadAll(entries: readonly DownloadEntry[]): Promise<void> {
    const total: number | undefined = entries.reduce<number | undefined>(
      (sum, e) =>
        e.size === undefined ? undefined : (sum ?? 0) + e.size,
      undefined
    );

    const session: BatchSession = {
      completed: 0,
      currentFile: undefined,
      totalBytes: total,
      seenDeclaredLengths: new Set()
    };

    // A failed file only renders the whole task useless when the failure is
    // stable; bursting congestion clears within seconds, so a bounded number
    // of follow-up passes over just the leftovers recovers from that case.
    let failed: Array<{ entry: DownloadEntry; error: unknown }> = [];
    for (let pass = 0; pass < this.batchPasses; pass++) {
      if (pass > 0) await delay(1000 * pass);
      const attempt =
        pass === 0 ? entries : failed.map((failure) => failure.entry);
      if (attempt.length === 0) break;
      failed = await this.runBatch(attempt, entries.length, session);
      if (failed.length === 0) break;
      if (this.signal?.aborted && session.completed < entries.length) {
        throw new DownloadError('Download aborted', '');
      }
    }
    if (failed.length > 0) {
      const first = failed[0]!;
      throw first.error instanceof Error
        ? first.error
        : new DownloadError(`Failed to download ${first.entry.url}`, first.entry.url);
    }
  }

  /** Runs one parallel pass over `entries`, returning the ones that failed. */
  private async runBatch(
    entries: readonly DownloadEntry[],
    entriesLength: number,
    session: BatchSession
  ): Promise<Array<{ entry: DownloadEntry; error: unknown }>> {
    let lastPublishAt = 0;
    // Speed samples only start once bytes actually flow; seed the baseline.
    this.resetSpeedSamples();
    const publish = (force: boolean): void => {
      const now = Date.now();
      if (!force && now - lastPublishAt < 150) return;
      lastPublishAt = now;
      this.onProgress?.({
        // A re-pass revisits some files, so clamp the counter so the bar
        // never overruns the batch even after retries.
        completed: Math.min(session.completed, entriesLength),
        total: entriesLength,
        downloadedBytes: this.downloadedBytes,
        totalBytes: session.totalBytes,
        currentFile: session.currentFile,
        bytesPerSecond: this.bytesPerSecond
      });
    };

    let cursor = 0;
    const failures: Array<{ entry: DownloadEntry; error: unknown }> = [];
    const workers = Array.from(
      { length: Math.min(this.concurrency, entries.length) },
      async () => {
        while (cursor < entries.length) {
          if (this.signal?.aborted) return;
          const entry = entries[cursor++]!;
          session.currentFile = fileNameOf(entry.destination);
          publish(false);
          try {
            await this.downloadOne(entry, session, publish);
          } catch (error) {
            failures.push({ entry, error });
          } finally {
            session.completed++;
            publish(true);
          }
        }
      }
    );
    await Promise.all(workers);
    publish(true);
    return failures;
  }

  /** Downloads a single file, giving every URL its own retry budget before falling through to the next candidate. */
  async downloadOne(
    entry: DownloadEntry,
    session?: BatchSession,
    publish?: (force: boolean) => void
  ): Promise<void> {
    if (await sha1Matches(entry.destination, entry.sha1, entry.size)) return;

    await mkdir(dirname(entry.destination), { recursive: true });
    const tempPath = `${entry.destination}.download`;
    const candidates = [entry.url, ...(entry.altUrls ?? [])];
    let lastError: unknown = new DownloadError(`Failed to download ${entry.url}`, entry.url);
    for (const url of candidates) {
      for (let attempt = 1; attempt <= this.retries; attempt++) {
        try {
          await this.fetchToFile(entry, url, session, publish);
          if (!(await sha1Matches(entry.destination, entry.sha1, entry.size))) {
            // A corrupt final file must not be resumed later; drop it so the
            // next candidate or pass starts from a clean slate.
            await unlink(entry.destination).catch(() => {});
            await unlink(tempPath).catch(() => {});
            throw new DownloadError(`SHA-1 mismatch for ${entry.destination}`, url);
          }
          return;
        } catch (error) {
          lastError = error;
          // Permanent 4xx (except 408/429) → don't waste retries, try next URL immediately
          if (error instanceof DownloadError && error.isPermanent()) {
            break;
          }
          if (attempt < this.retries) await delay(Math.min(500 * attempt, 2000));
        }
      }
    }
    // Exhausted every URL: clear the partial so a later pass re-downloads
    // fresh instead of resuming a hopeless fragment.
    await unlink(tempPath).catch(() => {});
    throw lastError instanceof Error
      ? lastError
      : new DownloadError(`Failed to download ${entry.url}`, entry.url);
  }

  private async fetchToFile(
    entry: DownloadEntry,
    url: string,
    session: BatchSession | undefined,
    publish: ((force: boolean) => void) | undefined
  ): Promise<void> {
    const tempPath = `${entry.destination}.download`;
    // Reuse bytes already flushed by a previous interrupted attempt: large
    // files on flaky networks finish incrementally instead of restarting.
    const resumedBytes = await fileSize(tempPath);
    const controller = new AbortController();
    // A dead mirror typically hangs on connecting or waiting for headers; the
    // header timer bounds that wait so the caller's fallback URL gets a turn.
    // The idle timer reacts to stalls mid-stream, where the socket stops
    // delivering bytes — leaving it unguarded would wedge the batch forever.
    const headerTimer = setTimeout(() => controller.abort(), this.headerTimeoutMs);
    let idleTimer: NodeJS.Timeout | undefined;
    const armIdle = (): void => {
      if (idleTimer !== undefined) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => controller.abort(), this.idleTimeoutMs);
    };
    armIdle();
    const signal =
      this.signal === undefined
        ? controller.signal
        : AbortSignal.any([this.signal, controller.signal]);
    try {
      const headers: Record<string, string> = {};
      if (resumedBytes > 0) headers['Range'] = `bytes=${resumedBytes}-`;
      const response = await fetch(url, {
        headers,
        redirect: 'follow',
        signal
      });
      if (response.status === 416) {
        // A partial that the server cannot continue is treated as corrupt:
        // discard it so the next attempt starts from a clean slate.
        await unlink(tempPath).catch(() => {});
        throw new DownloadError(`Stale partial download for ${url}`, entry.url);
      }
      if ((response.status !== 200 && response.status !== 206) || response.body === null) {
        throw new DownloadError(`HTTP ${response.status} for ${url}`, entry.url, response.status);
      }
      const resuming = response.status === 206;

      // Grow the batch total when the server knows the true size but the
      // entry did not, so progress bars converge rather than overshoot wildly.
      const declaredLength = Number(response.headers.get('content-length'));
      if (
        session !== undefined &&
        Number.isFinite(declaredLength) &&
        declaredLength > 0 &&
        entry.size === undefined &&
        !resuming &&
        !session.seenDeclaredLengths.has(url)
      ) {
        session.totalBytes = (session.totalBytes ?? 0) + declaredLength;
        session.seenDeclaredLengths.add(url);
      }

      // Count every flushed chunk so `downloadedBytes` and the speed gauge
      // track the wire while the file streams to its temp location.
      const counter = new Transform({
        transform: (chunk: unknown, _encoding, callback) => {
          this.downloadedBytes += (chunk as Buffer).length;
          this.sampleSpeed();
          armIdle();
          publish?.(false);
          callback(null, chunk);
        }
      });
      // Append when resuming, truncate otherwise. On failure the partial
      // bytes stay on disk so the next attempt can Range-resume them.
      await pipeline(
        Readable.fromWeb(response.body as import('node:stream/web').ReadableStream),
        counter,
        createWriteStream(tempPath, { flags: resuming && resumedBytes > 0 ? 'a' : 'w' })
      );
      await stat(tempPath); // ensure flush completed
      await rename(tempPath, entry.destination);
    } finally {
      clearTimeout(headerTimer);
      if (idleTimer !== undefined) clearTimeout(idleTimer);
    }
  }

  /** Resets the throughput gauge for a new batch. */
  private resetSpeedSamples(): void {
    this.downloadedBytes = 0;
    this.lastSampleTime = 0;
    this.lastSampleBytes = 0;
    this.bytesPerSecond = 0;
  }

  /** Samples the instantaneous rate and folds it into the moving average. */
  private sampleSpeed(): void {
    const now = Date.now();
    if (this.lastSampleTime === 0) {
      this.lastSampleTime = now;
      this.lastSampleBytes = this.downloadedBytes;
      return;
    }
    const elapsed = now - this.lastSampleTime;
    const delta = this.downloadedBytes - this.lastSampleBytes;
    if (elapsed <= 0 || delta <= 0) return;
    const instant = (delta / elapsed) * 1000;
    this.bytesPerSecond =
      this.bytesPerSecond === 0
        ? instant
        : this.bytesPerSecond * 0.6 + instant * 0.4;
    this.lastSampleTime = now;
    this.lastSampleBytes = this.downloadedBytes;
  }
}

/** Computes the SHA-1 of a local file, or undefined when it is absent. */
export async function sha1OfFile(path: string): Promise<string | undefined> {
  try {
    const hash = createHash('sha1');
    await pipeline(createReadStream(path), hash);
    return hash.digest('hex');
  } catch {
    return undefined;
  }
}

async function sha1Matches(
  path: string,
  expected: string | undefined,
  expectedSize?: number
): Promise<boolean> {
  if (expected === undefined) {
    try {
      const stats = await stat(path);
      if (expectedSize !== undefined && stats.size !== expectedSize) return false;
      return true;
    } catch {
      return false;
    }
  }
  return (await sha1OfFile(path)) === expected.toLowerCase();
}

/** Returns the byte length of a file, or 0 when it does not exist. */
async function fileSize(path: string): Promise<number> {
  try {
    return (await stat(path)).size;
  } catch {
    return 0;
  }
}

function fileNameOf(path: string): string {
  const index = path.lastIndexOf('/');
  return index >= 0 ? path.slice(index + 1) : path;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}