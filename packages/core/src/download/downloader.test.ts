import { createServer, type Server } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DownloadError, Downloader, type DownloadProgress } from './downloader.js';

const SLOW_PAYLOAD = Buffer.alloc(256 * 1024, 0xab);
const FAST_PAYLOAD = Buffer.alloc(64 * 1024, 0xcd);

function sha1Hex(data: Buffer): string {
  return createHash('sha1').update(data).digest('hex');
}

let server: Server;
let baseUrl: string;

/** Per-test mutable failure counter for the `/flaky` route. */
let flakyFailuresLeft = 0;

/** How many `/resume` requests must be interrupted mid-body before resuming normally. */
let resumeInterruptionsLeft = 0;

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === '/resume') {
      // First request (no Range): begin streaming then yank the socket after
      // half the payload so the client must Range-resume on the next attempt.
      if (resumeInterruptionsLeft > 0 && req.headers.range === undefined) {
        resumeInterruptionsLeft--;
        res.writeHead(200, { 'content-length': FAST_PAYLOAD.length });
        res.write(FAST_PAYLOAD.subarray(0, FAST_PAYLOAD.length / 2));
        res.destroy();
        return;
      }
      const range = req.headers.range;
      if (range !== undefined) {
        const start = Number(range.replace(/^bytes=/, '').split('-')[0]!);
        const end = FAST_PAYLOAD.length - 1;
        res.writeHead(206, {
          'content-length': String(end - start + 1),
          'content-range': `bytes ${start}-${end}/${FAST_PAYLOAD.length}`
        });
        res.end(FAST_PAYLOAD.subarray(start));
      } else {
        res.writeHead(200, { 'content-length': FAST_PAYLOAD.length });
        res.end(FAST_PAYLOAD);
      }
      return;
    }
    if (req.url === '/slow') {
      res.writeHead(200, { 'content-length': SLOW_PAYLOAD.length });
      let sent = 0;
      // Throttle the response so the speed gauge has measurable wall time.
      const timer = setInterval(() => {
        res.write(SLOW_PAYLOAD.subarray(sent, sent + 32 * 1024));
        sent += 32 * 1024;
        if (sent >= SLOW_PAYLOAD.length) {
          clearInterval(timer);
          res.end();
        }
      }, 40);
    } else if (req.url === '/fast') {
      res.writeHead(200, { 'content-length': FAST_PAYLOAD.length });
      res.end(FAST_PAYLOAD);
    } else if (req.url === '/flaky') {
      if (flakyFailuresLeft > 0) {
        flakyFailuresLeft--;
        res.writeHead(503);
        res.end();
      } else {
        res.writeHead(200, { 'content-length': FAST_PAYLOAD.length });
        res.end(FAST_PAYLOAD);
      }
    } else if (req.url === '/missing') {
      res.writeHead(404);
      res.end();
    } else {
      res.writeHead(500);
      res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('unreachable');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error === undefined ? resolve() : reject(error)))
  );
});

describe('Downloader progress reporting', () => {
  it('streams byte-level progress with a positive speed estimate', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hmcl-dl-'));
    try {
      const destinationOne = join(dir, 'slow.bin');
      const destinationTwo = join(dir, 'fast.bin');
      const snapshots: DownloadProgress[] = [];
      await new Downloader({
        concurrency: 1,
        onProgress: (progress) => snapshots.push(progress)
      }).downloadAll([
        {
          url: `${baseUrl}/slow`,
          destination: destinationOne,
          size: SLOW_PAYLOAD.length
        },
        {
          url: `${baseUrl}/fast`,
          destination: destinationTwo,
          size: FAST_PAYLOAD.length
        }
      ]);

      const last = snapshots[snapshots.length - 1]!;
      expect(last.completed).toBe(2);
      expect(last.total).toBe(2);
      expect(last.downloadedBytes).toBe(SLOW_PAYLOAD.length + FAST_PAYLOAD.length);
      expect(last.totalBytes).toBe(SLOW_PAYLOAD.length + FAST_PAYLOAD.length);
      expect(last.currentFile).toBe('fast.bin');
      expect(last.bytesPerSecond).toBeGreaterThan(0);

      // Some midpoint snapshot must carry partial byte progress.
      const midpoint = snapshots.some(
        (progress) =>
          progress.downloadedBytes > 0 &&
          progress.downloadedBytes < SLOW_PAYLOAD.length + FAST_PAYLOAD.length
      );
      expect(midpoint).toBe(true);

      // A mid-stream snapshot of the throttled file must expose a speed.
      const speeding = snapshots.some((progress) => progress.bytesPerSecond > 0);
      expect(speeding).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('skips files whose SHA-1 already matches without touching the network', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hmcl-dl-'));
    try {
      const destination = join(dir, 'cached.bin');
      const { writeFile } = await import('node:fs/promises');
      await writeFile(destination, FAST_PAYLOAD);
      const snapshots: DownloadProgress[] = [];
      await new Downloader({
        onProgress: (progress) => snapshots.push(progress)
      }).downloadAll([
        {
          url: `${baseUrl}/missing`,
          destination,
          sha1: sha1Hex(FAST_PAYLOAD)
        }
      ]);
      const last = snapshots[snapshots.length - 1]!;
      expect(last.completed).toBe(1);
      expect(last.downloadedBytes).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('throws DownloadError after retries for a missing resource', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hmcl-dl-'));
    try {
      const destination = join(dir, 'missing.bin');
      const downloader = new Downloader({ retries: 1 });
      await expect(
        downloader.downloadAll([{ url: `${baseUrl}/missing`, destination }])
      ).rejects.toBeInstanceOf(DownloadError);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('recovers via a follow-up batch pass when a resource flakily fails', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hmcl-dl-'));
    try {
      // Burn the whole per-URL retry budget an earlier pass, then succeed.
      flakyFailuresLeft = 4;
      const destination = join(dir, 'flaky.bin');
      await new Downloader({ retries: 2 }).downloadAll([
        { url: `${baseUrl}/flaky`, destination, size: FAST_PAYLOAD.length }
      ]);
      const { stat } = await import('node:fs/promises');
      const info = await stat(destination);
      expect(info.size).toBe(FAST_PAYLOAD.length);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('resumes a file from its partial bytes after a mid-body interruption', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hmcl-dl-'));
    try {
      resumeInterruptionsLeft = 1;
      const destination = join(dir, 'resume.bin');
      await new Downloader({ retries: 2 }).downloadAll([
        {
          url: `${baseUrl}/resume`,
          destination,
          sha1: sha1Hex(FAST_PAYLOAD),
          size: FAST_PAYLOAD.length
        }
      ]);
      const { stat } = await import('node:fs/promises');
      const info = await stat(destination);
      expect(info.size).toBe(FAST_PAYLOAD.length);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});