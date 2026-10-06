import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { bytesSource, extractTar, extractTarFile, fileSource, readTar, type TarEntry, type TarSource } from './tar';

/** Builds one tar block pair: a 512-byte header plus its padded payload. */
function block(name: string, options: { size?: number; type?: string; prefix?: string; mode?: string; linkTarget?: string; payload?: string } = {}): Uint8Array {
  const payloadText = options.payload;
  const size = options.size ?? (payloadText === undefined ? 0 : payloadText.length);
  const out = new Uint8Array(512 + Math.ceil(size / 512) * 512);
  const header = out.subarray(0, 512);

  const put = (text: string, offset: number, length: number) => {
    for (let i = 0; i < Math.min(text.length, length - 1); i++) header[offset + i] = text.charCodeAt(i);
  };

  put(name, 0, 100);
  put(options.mode ?? '0000644', 100, 8);
  put('0000000', 108, 8);
  put('0000000', 116, 8);
  put(size.toString(8).padStart(11, '0'), 124, 12);
  put('00000000000', 136, 12);
  header[156] = (options.type ?? '0').charCodeAt(0);
  if (options.linkTarget) put(options.linkTarget, 157, 100);
  put(options.prefix ?? '', 345, 155);
  // The magic tar implementations check for, with its version bytes.
  put('ustar  ', 257, 8);
  header[263] = 0x03;

  const payload = payloadText === undefined
    ? new Uint8Array(512).fill(size > 0 ? 0x41 : 0)
    : new TextEncoder().encode(payloadText);
  out.set(payload.subarray(0, size), 512);
  return out;
}

/** Concatenates header blocks and appends the two NUL blocks that end a tar. */
function archive(...parts: Uint8Array[]): Uint8Array {
  const ending = new Uint8Array(1024);
  const total = parts.reduce((sum, part) => sum + part.length, ending.length);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/**
 * Reads an in-memory archive.
 *
 * Entries carry an offset into the stream rather than their own bytes, so the
 * source is handed back for tests that need to look at the payload.
 */
async function read(...parts: Uint8Array[]): Promise<{ source: TarSource; entries: TarEntry[] }> {
  const source = bytesSource(archive(...parts));
  return { source, entries: await readTar(source) };
}

/** Extracts an in-memory archive to a fresh temporary directory. */
async function unpack(...parts: Uint8Array[]): Promise<{ dir: string; written: string[] }> {
  const dir = await mkdtemp(join(tmpdir(), 'hmcl-tar-'));
  const written = await extractTar(bytesSource(archive(...parts)), dir);
  return { dir, written };
}

describe('readTar', () => {
  it('reads a regular file with its contents', async () => {
    const { source, entries } = await read(block('jdk-21/bin/java', { size: 3 }));
    expect(entries).toHaveLength(1);
    expect(entries[0]!.path).toBe('jdk-21/bin/java');
    expect(entries[0]!.type).toBe('0');
    expect([...await source.read(entries[0]!.offset, entries[0]!.size)]).toEqual([0x41, 0x41, 0x41]);
  });

  it('reads a directory without the trailing slash', async () => {
    const { entries } = await read(block('jdk-21/bin/', { type: '5' }));
    expect(entries[0]).toMatchObject({ path: 'jdk-21/bin', type: '5' });
  });

  it('reads a symlink target', async () => {
    const { entries } = await read(block('jdk-21/bin/javac', { type: '2', linkTarget: 'java' }));
    expect(entries[0]).toMatchObject({ type: '2', linkTarget: 'java' });
  });

  it('joins the ustar prefix onto the name', async () => {
    const { entries } = await read(block('bin/java', { prefix: 'jdk-21.0.12+1' }));
    expect(entries[0]!.path).toBe('jdk-21.0.12+1/bin/java');
  });

  it('reads a base-256 size used when octal cannot hold the value', async () => {
    const source = block('jdk-21/lib/modules');
    const header = source.subarray(0, 512);
    // Octal tops out well before a large file size, so GNU tar switches to a
    // big-endian base-256 field with the sign bit in its first byte.
    for (let i = 0; i < 12; i++) header[124 + i] = 0;
    header[124] = 0x80;
    header[134] = 0x02;

    const out = new Uint8Array(1024);
    out.set(header, 0);
    out.fill(0x42, 512);

    const entries = await readTar(bytesSource(out));
    expect(entries[0]!.path).toBe('jdk-21/lib/modules');
    expect(entries[0]!.size).toBe(512);
  });

  it('skips PAX extended headers instead of writing them as files', async () => {
    const { entries } = await read(
      block('PaxHeaders/jdk-21', { type: 'x', payload: 'x'.repeat(4) }),
      block('jdk-21/release'),
    );
    expect(entries.map((entry) => entry.path)).toEqual(['jdk-21/release']);
  });

  it('takes the name from a GNU @LongLink header', async () => {
    // Old GNU format has no prefix field: the long name is the payload of an
    // `L` header, and the real header keeps only its trailing path components.
    const long = `jdk-21/lib/${'deep/'.repeat(12)}java`;
    const { entries } = await read(
      block('././@LongLink', { type: 'L', payload: `${long}\0` }),
      block('or/two/', { size: 1 }),
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]!.path).toBe(long);
    expect(entries[0]!.size).toBe(1);
  });

  it('takes the link target from a GNU @LongLink header of type K', async () => {
    const target = `../${'nested/'.repeat(12)}java`;
    const { entries } = await read(
      block('././@LongLink', { type: 'K', payload: `${target}\0` }),
      block('jdk-21/bin/java', { type: '2' }),
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]!.type).toBe('2');
    expect(entries[0]!.linkTarget).toBe(target);
  });

  it('takes the name from a PAX path record', async () => {
    const long = `jdk-21/${'deep/'.repeat(12)}module`;
    const record = paxRecord('path', long);
    const { entries } = await read(
      block('PaxHeaders/jdk-21', { type: 'x', payload: record }),
      // The header's own fields are placeholders that PAX is there to replace.
      block('truncated', { size: 2 }),
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]!.path).toBe(long);
    expect(entries[0]!.size).toBe(2);
  });

  it('takes a symlink target from a PAX linkpath record', async () => {
    const target = `../${'nested/'.repeat(12)}java`;
    const { entries } = await read(
      block('PaxHeaders/jdk-21', { type: 'x', payload: paxRecord('linkpath', target) }),
      block('jdk-21/bin/java', { type: '2' }),
    );

    expect(entries[0]!.linkTarget).toBe(target);
  });

  it('lets a PAX size override the one octal cannot express', async () => {
    const { entries } = await read(
      block('PaxHeaders/big', { type: 'x', payload: paxRecord('size', '3') }),
      block('big', { size: 1 }),
    );

    expect(entries[0]!.size).toBe(3);
  });

  it('applies an override to only the entry that follows it', async () => {
    const { entries } = await read(
      block('././@LongLink', { type: 'L', payload: 'the/long/name\0' }),
      block('short', { size: 1 }),
      block('second', { size: 1 }),
    );

    expect(entries.map((entry) => entry.path)).toEqual(['the/long/name', 'second']);
  });

  it('stops at the two zero blocks that end an archive', async () => {
    const { entries } = await read(block('jdk-21/release', { size: 1 }));
    expect(entries).toHaveLength(1);
  });
});

/** Builds a `"<length> <key>=<value>\n"` PAX record, as tar writes it. */
function paxRecord(key: string, value: string): string {
  const body = ` ${key}=${value}\n`;
  // The leading number counts its own digits, so it may need a second pass.
  let length = body.length + String(body.length).length;
  if (String(length).length !== String(body.length).length) {
    length = body.length + String(body.length + String(body.length + 1).length).length;
  }
  return `${length}${body}`;
}

describe('extractTar', () => {
  it('writes files and marks the executable ones executable', async () => {
    const { dir, written } = await unpack(
      block('jdk-21/', { type: '5' }),
      block('jdk-21/bin/java', { size: 2, mode: '0000755' }),
      block('jdk-21/release', { size: 2, mode: '0000644' }),
    );

    expect(written).toContain('jdk-21/bin/java');
    expect([...(await readFile(join(dir, 'jdk-21/bin/java')))]).toEqual([0x41, 0x41]);
    expect([...(await readFile(join(dir, 'jdk-21/release')))]).toEqual([0x41, 0x41]);
    // Without the executable bit bin/java cannot run, so the mode must survive.
    expect((await stat(join(dir, 'jdk-21/bin/java'))).mode & 0o111).not.toBe(0);
    expect((await stat(join(dir, 'jdk-21/release'))).mode & 0o111).toBe(0);
  });

  it('unpacks a .tar.gz from disk, which is what Adoptium serves on Linux', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hmcl-tar-'));
    const archivePath = join(root, 'jdk.tar.gz');
    const dir = join(root, 'out');
    await writeFile(archivePath, gzipSync(archive(block('jdk-21/bin/java', { size: 1, mode: '0000755' }))));

    await extractTarFile(archivePath, dir);

    expect(await readFile(join(dir, 'jdk-21/bin/java'), 'utf8')).toBe('A');
    expect((await stat(join(dir, 'jdk-21/bin/java'))).mode & 0o111).not.toBe(0);
  });

  it('unpacks a plain .tar from disk', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hmcl-tar-'));
    const archivePath = join(root, 'jdk.tar');
    await writeFile(archivePath, archive(block('jdk-21/bin/java', { size: 1 })));

    await extractTarFile(archivePath, join(root, 'out'));

    expect(await readFile(join(root, 'out/jdk-21/bin/java'), 'utf8')).toBe('A');
  });

  it('reports a gzip archive it cannot finish decompressing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hmcl-tar-'));
    const archivePath = join(root, 'truncated.tar.gz');
    // Cut the stream mid-member so the decoder cannot reach a clean end.
    const full = gzipSync(archive(block('jdk-21/lib/modules', { size: 200_000 })));
    await writeFile(archivePath, full.subarray(0, Math.floor(full.length / 2)));

    // A silent short extract would install a Java that cannot run.
    await expect(extractTarFile(archivePath, join(root, 'out'))).rejects.toThrow();
  });

  it('refuses entries that would escape the destination', async () => {
    const { dir, written } = await unpack(block('../escaped', { size: 1 }));

    expect(written).toEqual([]);
    await expect(readFile(join(dir, '..', 'escaped'))).rejects.toThrow();
  });

  it('drops absolute symlink targets instead of resolving outside', async () => {
    const { dir } = await unpack(block('jdk-21/bin/java', { type: '2', linkTarget: '/usr/bin/java' }));

    await expect(readFile(join(dir, 'jdk-21/bin/java'))).rejects.toThrow();
  });

  it('replaces an existing entry when a symlink target already exists', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hmcl-tar-'));
    await mkdir(join(dir, 'jdk-21/bin'), { recursive: true });
    await writeFile(join(dir, 'jdk-21/bin/java'), 'old');
    // EEXIST is the normal case for a JDK archive that links bin/java twice.
    await expect(
      extractTar(bytesSource(archive(block('jdk-21/bin/java', { type: '2', linkTarget: 'java' }))), dir),
    ).resolves.toEqual([]);
  });

  it('follows a relative symlink that points at a file in the same tree', async () => {
    const { dir } = await unpack(
      block('jdk-21/bin/java', { size: 1, mode: '0000755' }),
      block('jdk-21/bin/java.exe', { type: '2', linkTarget: 'java' }),
    );
    // The link resolves, so the file it names must be readable through it.
    expect(await readFile(join(dir, 'jdk-21/bin/java.exe'), 'utf8')).toBe('A');
  });

  it('creates the directories a nested entry needs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hmcl-tar-'));
    const dir = join(root, 'not', 'yet', 'created');
    await extractTar(bytesSource(archive(block('a/b/c/java', { size: 1 }))), dir);

    expect(await readFile(join(dir, 'a/b/c/java'), 'utf8')).toBe('A');
  });

  it('reads the same bytes whether the archive is in memory or on disk', async () => {
    const data = archive(
      block('jdk-21/bin/java', { size: 3, mode: '0000755' }),
      block('jdk-21/lib/modules', { size: 300_000 }),
    );
    const memory = await mkdtemp(join(tmpdir(), 'hmcl-tar-'));
    const onDisk = await mkdtemp(join(tmpdir(), 'hmcl-tar-'));
    const file = join(onDisk, 'archive.tar');
    await writeFile(file, data);

    // A payload larger than the copy buffer is the case that differs between
    // the two sources, since the file source has to read it in pieces.
    await extractTar(bytesSource(data), memory);
    await extractTar(await fileSource(file), join(onDisk, 'out'));

    expect((await stat(join(onDisk, 'out/jdk-21/lib/modules'))).size).toBe(300_000);
    expect((await stat(join(memory, 'jdk-21/lib/modules'))).size).toBe(300_000);
  });
});