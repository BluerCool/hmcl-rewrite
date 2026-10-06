/**
 * A minimal tar reader, enough to unpack a JDK archive.
 *
 * tar has no dependency worth taking for one format: entries are 512-byte
 * headers followed by their payload, padded to a block. Adoptium ships
 * `.tar.gz`, so the gzip layer comes from fflate and this handles what is
 * underneath.
 *
 * Everything is expressed in terms of a seekable {@link TarSource} rather than
 * one buffer. A Temurin JDK is ~198 MB compressed and ~350 MB as a tar, and a
 * single entry (`lib/modules`) is over 100 MB, so the reader only pulls header
 * blocks and the extractor copies payloads through a small fixed buffer. Holding
 * a whole archive in memory would put the launcher itself out of memory.
 *
 * Only the parts a JDK archive actually uses are implemented — regular files,
 * directories and symlinks. Hard links and device nodes are skipped.
 */
import { createWriteStream } from 'node:fs';
import { once } from 'node:events';
import { chmod, mkdir, open, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { finished } from 'node:stream/promises';
import { Gunzip } from 'fflate';

const BLOCK = 512;

/** Copy size for payloads and for decompression, chosen to stay off the heap's fast path. */
const CHUNK = 64 * 1024;

/** Random-access bytes: an in-memory buffer and an on-disk file behave the same. */
export interface TarSource {
  /** Total byte length of the tar stream. */
  readonly size: number;
  /** Reads exactly `length` bytes at `offset`, or fewer at the end of the stream. */
  read(offset: number, length: number): Promise<Uint8Array>;
  /** Releases the file handle a file-backed source holds, if any. */
  close?(): Promise<void>;
}

/** One entry as described by its header. */
export interface TarEntry {
  /** Path inside the archive, always with forward slashes. */
  readonly path: string;
  /** `'0'` for a regular file, `'5'` for a directory, `'2'` for a symlink. */
  readonly type: string;
  /** Byte offset of the payload within the tar stream. */
  readonly offset: number;
  /** Payload length in bytes. */
  readonly size: number;
  /** Symlink target, only for type `'2'`. */
  readonly linkTarget?: string;
  /** Unix mode bits from the header, when present. */
  readonly mode?: number;
}

/** A {@link TarSource} over bytes already in memory. */
export function bytesSource(data: Uint8Array): TarSource {
  return {
    size: data.length,
    read: (offset, length) => Promise.resolve(data.subarray(offset, offset + length)),
  };
}

/** A {@link TarSource} that reads lazily from a file on disk. */
export async function fileSource(path: string): Promise<TarSource> {
  const handle = await open(path, 'r');
  const { size } = await handle.stat();
  return {
    size,
    read: async (offset, length) => {
      const buffer = Buffer.allocUnsafe(length);
      const { bytesRead } = await handle.read(buffer, 0, length, offset);
      return new Uint8Array(buffer.buffer, buffer.byteOffset, bytesRead);
    },
    close: () => handle.close(),
  };
}

/** True when the path would escape `root` via `..` or an absolute prefix. */
function escapes(path: string): boolean {
  if (path.startsWith('/') || path.startsWith('\\')) return true;
  return path.split(/[/\\]/).some((part) => part === '..');
}

/** Reads a NUL-terminated header field as text. */
function field(block: Uint8Array, offset: number, length: number): string {
  let end = offset;
  const limit = offset + length;
  while (end < limit && block[end] !== 0) end++;
  let text = '';
  for (let i = offset; i < end; i++) text += String.fromCharCode(block[i]!);
  return text;
}

/**
 * Parses a base-256 (high-bit) numeric field, which GNU tar uses for sizes and
 * mtimes too large for octal.
 */
function numeric(block: Uint8Array, offset: number, length: number): number {
  if ((block[offset]! & 0x80) === 0) {
    const text = field(block, offset, length).trim();
    return text === '' ? 0 : parseInt(text, 8) || 0;
  }
  let value = 0;
  // The leading byte carries the sign in its low bit; drop it and keep the rest.
  for (let i = offset + 1; i < offset + length; i++) {
    value = value * 256 + block[i]!;
  }
  return value;
}

/**
 * Parses the payload of a PAX extended header.
 *
 * Records are `"<length> <key>=<value>\n"` where the length counts itself, so
 * the reader has to resync by that count rather than by newline.
 */
function readPaxRecords(payload: Uint8Array): Map<string, string> {
  const records = new Map<string, string>();
  const text = new TextDecoder().decode(payload);
  let at = 0;
  while (at < text.length) {
    const space = text.indexOf(' ', at);
    if (space < 0) break;
    const length = parseInt(text.slice(at, space), 10);
    if (!Number.isFinite(length) || length <= space - at) break;
    const record = text.slice(space + 1, at + length).replace(/\n$/, '');
    const equals = record.indexOf('=');
    if (equals > 0) records.set(record.slice(0, equals), record.slice(equals + 1));
    at += length;
  }
  return records;
}

/** Strips the NUL or newline padding that follows a name held in a payload. */
function trimPayload(payload: Uint8Array): string {
  const text = new TextDecoder().decode(payload);
  const nul = text.indexOf('\0');
  return text.slice(0, nul < 0 ? text.length : nul).replace(/\n$/, '');
}

/**
 * Reads every entry in a plain tar stream, reading only the header blocks.
 *
 * The source must already be uncompressed; {@link extractTarFile} is what sniffs
 * a gzip layer and stages it before calling this.
 */
export async function readTar(source: TarSource): Promise<TarEntry[]> {
  const entries: TarEntry[] = [];
  let offset = 0;

  // A name too long for the 100-byte header field arrives in a separate header
  // that describes only the entry after it: GNU writes the whole name into an
  // `@LongLink` payload, PAX writes a `path=` record.
  let overriddenName: string | undefined;
  let overriddenLink: string | undefined;
  let overriddenSize: number | undefined;

  while (offset + BLOCK <= source.size) {
    const header = await source.read(offset, BLOCK);
    // A short read means the stream ends here.
    if (header.length < BLOCK) break;
    // Two consecutive zero blocks mark the end of the archive.
    if (header.every((byte) => byte === 0)) break;

    const name = field(header, 0, 100);
    const prefix = field(header, 345, 155);
    const size = numeric(header, 124, 12);
    const type = field(header, 156, 1) || '0';
    const mode = numeric(header, 100, 8);
    const padded = Math.ceil(size / BLOCK) * BLOCK;

    if (type === 'L' || type === 'K') {
      const value = trimPayload(await source.read(offset + BLOCK, size));
      if (type === 'L') overriddenName = value;
      else overriddenLink = value;
      offset += BLOCK + padded;
      continue;
    }
    if (type === 'x' || type === 'g') {
      const records = readPaxRecords(await source.read(offset + BLOCK, size));
      overriddenName = records.get('path') ?? overriddenName;
      overriddenLink = records.get('linkpath') ?? overriddenLink;
      const declared = records.get('size');
      // A PAX size wins: it is the only way to express a size octal cannot hold.
      if (declared !== undefined && Number.isFinite(Number(declared))) overriddenSize = Number(declared);
      offset += BLOCK + padded;
      continue;
    }

    const path = overriddenName ?? (prefix === '' ? name : `${prefix}/${name}`);
    const entrySize = overriddenSize ?? size;
    const entry: TarEntry = { path, type, offset: offset + BLOCK, size: entrySize, mode };
    if (type === '0' || type === '') {
      entries.push(entry);
    } else if (type === '5') {
      entries.push({ ...entry, path: path.endsWith('/') ? path.slice(0, -1) : path, size: 0 });
    } else if (type === '2') {
      entries.push({
        ...entry,
        linkTarget: overriddenLink ?? field(header, 157, 100),
        size: 0,
      });
    }

    // An override describes the single entry that follows it, never the rest.
    overriddenName = undefined;
    overriddenLink = undefined;
    overriddenSize = undefined;

    offset += BLOCK + padded;
  }

  return entries;
}

/**
 * Writes the entries of a tar stream into `destination`, refusing any path that
 * would land outside it.
 *
 * Payloads are copied through a fixed-size buffer, so peak memory does not grow
 * with the size of the archive or of its largest file.
 *
 * @returns the paths written, relative to `destination`.
 */
export async function extractTar(source: TarSource, destination: string): Promise<string[]> {
  const entries = await readTar(source);
  const written: string[] = [];

  await mkdir(destination, { recursive: true });

  for (const entry of entries) {
    if (entry.path === '' || escapes(entry.path)) continue;
    const target = join(destination, entry.path);

    // A directory must exist before anything can be written inside it, and a
    // symlink may point at a directory that has not been created yet.
    await mkdir(dirname(target), { recursive: true }).catch(() => undefined);

    if (entry.type === '5') {
      await mkdir(target, { recursive: true });
      continue;
    }
    if (entry.type === '2') {
      const targetPath = entry.linkTarget ?? '';
      // Absolute symlinks inside a JDK archive (e.g. /usr/bin/java) are absolute
      // on the build machine, not here; dropping them is better than creating
      // something that resolves outside the extracted tree.
      if (targetPath === '' || targetPath.startsWith('/')) continue;
      // A JDK tarball often re-links the same relative target, so replacing any
      // existing entry is the normal case rather than an error.
      await rm(target, { force: true, recursive: true }).catch(() => undefined);
      await symlink(targetPath, target).catch(async () => {
        await writeFile(target, '').catch(() => undefined);
      });
      continue;
    }
    if (entry.size <= 0) {
      await writeFile(target, '').catch(() => undefined);
      continue;
    }

    const handle = await open(target, 'w');
    try {
      let remaining = entry.size;
      let at = entry.offset;
      while (remaining > 0) {
        const chunk = await source.read(at, Math.min(CHUNK, remaining));
        if (chunk.length === 0) break;
        await handle.write(chunk, 0, chunk.length);
        remaining -= chunk.length;
        at += chunk.length;
      }
    } finally {
      await handle.close();
    }

    if (entry.mode !== undefined && entry.mode > 0) {
      // The executable bit is the only mode that matters for a JDK: without it
      // `bin/java` cannot run.
      await chmod(target, entry.mode & 0o777).catch(() => undefined);
    }
    written.push(entry.path);
  }

  // The source may hold an open file handle; the caller handed it to us.
  await source.close?.().catch(() => undefined);
  return written;
}

/** True when the bytes start with the gzip magic `0x1f 0x8b`. */
export async function isGzip(path: string): Promise<boolean> {
  const handle = await open(path, 'r');
  try {
    const buffer = Buffer.allocUnsafe(2);
    const { bytesRead } = await handle.read(buffer, 0, 2, 0);
    return bytesRead === 2 && buffer[0] === 0x1f && buffer[1] === 0x8b;
  } finally {
    await handle.close();
  }
}

/**
 * Decompresses a gzip file to `destination`, streaming in both directions.
 *
 * Needed because a Temurin JDK expands to roughly twice its compressed size, so
 * `gunzipSync` on the download would allocate hundreds of megabytes at once.
 *
 * fflate's decompressor is push-based with a synchronous callback, so
 * backpressure is applied by awaiting the write stream's drain in the read loop
 * rather than by pausing the decoder.
 */
export async function gunzipToFile(source: string, destination: string): Promise<void> {
  const input = await open(source, 'r');
  const out = createWriteStream(destination);
  const { size } = await input.stat();

  let drain: Promise<unknown> | undefined;
  // Set while tearing down so a late callback cannot write to a dead stream.
  let stopped = false;
  const gunzip = new Gunzip((chunk, final) => {
    if (stopped) return;
    if (!out.write(chunk) && drain === undefined) drain = once(out, 'drain');
    if (final) out.end();
  });

  const closed = new Promise<void>((resolve, reject) => {
    out.on('close', () => resolve());
    out.on('error', reject);
  });

  let complete = false;
  try {
    const buffer = Buffer.allocUnsafe(CHUNK);
    for (let at = 0; at < size; ) {
      const { bytesRead } = await input.read(buffer, 0, CHUNK, at);
      if (bytesRead === 0) break;
      at += bytesRead;
      gunzip.push(new Uint8Array(buffer.buffer, buffer.byteOffset, bytesRead), false);
      if (drain !== undefined) {
        await drain;
        drain = undefined;
      }
    }
    // A zero-length final chunk tells fflate the stream is over. A truncated
    // archive throws here rather than yielding a partial result.
    gunzip.push(new Uint8Array(0), true);
    await closed;
    complete = true;
  } finally {
    stopped = true;
    await input.close();
    if (!complete) {
      // Close cleanly rather than destroying: a destroy mid-write makes Node's
      // own stream internals throw. The partial file is removed either way, so a
      // failed decompression never looks like a successful install.
      out.end();
      await finished(out).catch(() => undefined);
      await rm(destination, { force: true }).catch(() => undefined);
    }
  }
}

/**
 * Extracts a `.tar`, `.tar.gz` or `.tgz` archive from disk into `destination`.
 *
 * A gzipped archive is expanded to a sibling `.tar` first, since the extractor
 * seeks rather than streams. That temporary file is removed afterwards.
 *
 * @returns the paths written, relative to `destination`.
 */
export async function extractTarFile(archive: string, destination: string): Promise<string[]> {
  if (!(await isGzip(archive))) {
    return extractTar(await fileSource(archive), destination);
  }

  const plain = `${archive}.plain.tar`;
  await gunzipToFile(archive, plain);
  try {
    return extractTar(await fileSource(plain), destination);
  } finally {
    await rm(plain, { force: true }).catch(() => undefined);
  }
}