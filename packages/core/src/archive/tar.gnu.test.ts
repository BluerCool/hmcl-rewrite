import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractTarFile, fileSource, gunzipToFile, isGzip, readTar, type TarEntry } from './tar';

/** True when a working `tar` is on PATH; the fixtures below need a real one. */
function haveTar(): boolean {
  try {
    execFileSync('tar', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// Long enough that the reassembled path exceeds tar's 100-character name field,
// which is what forces GNU tar to split it across prefix and name.
const deep =
  'very/deeply/nested/path/that/exceeds/one/hundred/characters/for/sure/ok/directory/and/another/level/or/two';

/**
 * Builds a source tree containing every shape that distinguishes a real tar
 * from a synthetic one: a directory, an executable, a plain file, a symlink
 * that resolves inside the tree, a symlink pointing at a directory, a payload
 * larger than one block, and a path past tar's 100-character name field.
 */
async function fixture(): Promise<{ src: string; tarball: string }> {
  const root = await mkdtemp(join(tmpdir(), 'hmcl-tar-real-'));
  const src = join(root, 'src');
  await mkdir(join(src, 'jdk', 'bin'), { recursive: true });
  await mkdir(join(src, deep), { recursive: true });
  await writeFile(join(src, 'jdk', 'release'), 'JAVA_VERSION="21.0.12"\n');
  await writeFile(join(src, 'jdk', 'bin', 'java'), '#!/bin/sh\necho hi\n', { mode: 0o755 });
  await writeFile(join(src, 'jdk', 'bin', 'bigblob'), Buffer.alloc(200_000, 0x5a));
  await writeFile(join(src, deep, 'file.txt'), 'x');
  execFileSync('ln', ['-sf', 'java', join(src, 'jdk', 'bin', 'javac')]);
  execFileSync('ln', ['-sf', '../jdk/bin/java', join(src, 'jdk', 'liblink')]);
  return { src, tarball: root };
}

/**
 * Runs `tar` in the requested format and returns the path to the archive.
 *
 * v7 predates every long-name mechanism, so GNU tar refuses to store a path
 * over 99 characters in it at all; the fixture's long tree is left out there.
 */
async function pack(root: string, src: string, format: string, gzip: boolean): Promise<string> {
  const name = join(root, `archive-${format}${gzip ? '.tar.gz' : '.tar'}`);
  const members = format === 'v7' ? ['jdk'] : ['jdk', 'very'];
  execFileSync('tar', ['--format', format, gzip ? '-czf' : '-cf', name, '-C', src, ...members]);
  return name;
}

/** Reads an archive off disk the way production does, closing the handle after. */
async function entries(archivePath: string): Promise<TarEntry[]> {
  const plain = await plainTar(archivePath);
  const source = await fileSource(plain);
  try {
    return await readTar(source);
  } finally {
    await source.close?.();
    if (plain !== archivePath) await rm(plain, { force: true }).catch(() => undefined);
  }
}

/**
 * Stages a gzipped archive as a plain tar, which is what `extractTarFile` does
 * for real; `readTar` itself only ever sees uncompressed bytes.
 */
async function plainTar(archivePath: string): Promise<string> {
  if (!(await isGzip(archivePath))) return archivePath;
  const plain = `${archivePath}.plain.tar`;
  await gunzipToFile(archivePath, plain);
  return plain;
}

/** Ground truth: what GNU tar itself says the archive holds. */
function tarListing(archive: string): { mode: string; size: number; path: string }[] {
  return execFileSync('tar', ['-tvf', archive], { encoding: 'utf8' })
    .split('\n')
    .filter((line) => line.trim() !== '')
    .flatMap((line) => {
      // Columns are mode, owner/group, size, date, time, then the name; the name
      // is taken as the remainder because a path may contain spaces.
      const match = line.match(/^(\S{10})\s+\S+\s+(\d+)\s+(\S+)\s+(\S+)\s+(.*)$/);
      return match
        ? [{ mode: match[1]!, size: Number(match[2]), path: match[5]!.replace(/ -> .*/, '').replace(/\/$/, '') }]
        : [];
    });
}

const sha256 = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');

// Real archives are the only way to catch a header layout the hand-written
// builder agrees with but GNU tar does not, so these compare against `tar -tv`.
describe.skipIf(!haveTar())('readTar against archives GNU tar produced', () => {
  for (const format of ['gnu', 'posix', 'v7']) {
    const gzip = format !== 'v7';

    it(`reads every entry of a --format=${format} archive`, async () => {
      const { src, tarball } = await fixture();
      try {
        const archive = await pack(tarball, src, format, gzip);
        const listing = tarListing(archive);
        const found = await entries(archive);

        expect(found.filter((entry) => entry.type === '0')).toHaveLength(
          listing.filter((row) => row.mode.startsWith('-')).length,
        );
        expect(found.filter((entry) => entry.type === '5')).toHaveLength(
          listing.filter((row) => row.mode.startsWith('d')).length,
        );
        expect(found.filter((entry) => entry.type === '2')).toHaveLength(
          listing.filter((row) => row.mode.startsWith('l')).length,
        );
      } finally {
        await rm(tarball, { recursive: true, force: true });
      }
    });

    it(`reports the same byte size for every file as --format=${format}`, async () => {
      const { src, tarball } = await fixture();
      try {
        const archive = await pack(tarball, src, format, gzip);
        const expected = new Map(
          tarListing(archive)
            .filter((row) => row.mode.startsWith('-'))
            .map((row) => [row.path, row.size]),
        );
        // Large entries are exactly where a wrong size or padding rule shows up.
        expect(expected.get('jdk/bin/bigblob')).toBe(200_000);

        for (const entry of (await entries(archive)).filter((item) => item.type === '0')) {
          expect(entry.size, entry.path).toBe(expected.get(entry.path));
        }
      } finally {
        await rm(tarball, { recursive: true, force: true });
      }
    });
  }

  it('reproduces a path longer than the 100-character name field', async () => {
    const { src, tarball } = await fixture();
    try {
      const paths = (await entries(await pack(tarball, src, 'gnu', true))).map((entry) => entry.path);
      expect(paths).toContain(`${deep}/file.txt`);
      expect(paths.some((path) => path.length > 100)).toBe(true);
    } finally {
      await rm(tarball, { recursive: true, force: true });
    }
  });

  it('never yields an absolute or parent-escaping path', async () => {
    const { src, tarball } = await fixture();
    try {
      for (const entry of await entries(await pack(tarball, src, 'posix', true))) {
        expect(entry.path.startsWith('/'), entry.path).toBe(false);
        expect(entry.path.split('/')).not.toContain('..');
      }
    } finally {
      await rm(tarball, { recursive: true, force: true });
    }
  });
});

describe.skipIf(!haveTar())('extractTar against archives GNU tar produced', () => {
  for (const format of ['gnu', 'posix']) {
    it(`round-trips content and modes out of a --format=${format} archive`, async () => {
      const { src, tarball } = await fixture();
      const out = join(tarball, 'out');
      try {
        await extractTarFile(await pack(tarball, src, format, true), out);

        expect(sha256(await readFile(join(out, 'jdk/bin/bigblob')))).toBe(
          sha256(await readFile(join(src, 'jdk/bin/bigblob'))),
        );
        expect(await readFile(join(out, 'jdk/release'), 'utf8')).toBe('JAVA_VERSION="21.0.12"\n');

        // bin/java has to stay executable or the installed JDK cannot run.
        expect((await stat(join(out, 'jdk/bin/java'))).mode & 0o111).not.toBe(0);
        expect((await stat(join(out, 'jdk/release'))).mode & 0o111).toBe(0);

        // javac is stored as a link to java and must resolve through.
        expect(await readFile(join(out, 'jdk/bin/javac'), 'utf8')).toContain('echo hi');
        expect(await readFile(join(out, deep, 'file.txt'), 'utf8')).toBe('x');
      } finally {
        await rm(tarball, { recursive: true, force: true });
      }
    });
  }

  it('extracts the same tree twice into a clean directory', async () => {
    const { src, tarball } = await fixture();
    try {
      const archive = await pack(tarball, src, 'gnu', true);
      const first = join(tarball, 'first');
      const second = join(tarball, 'second');
      await extractTarFile(archive, first);
      await extractTarFile(archive, second);
      expect(sha256(await readFile(join(first, 'jdk/bin/bigblob')))).toBe(
        sha256(await readFile(join(second, 'jdk/bin/bigblob'))),
      );
    } finally {
      await rm(tarball, { recursive: true, force: true });
    }
  });

  it('leaves no temporary decompressed archive behind', async () => {
    const { src, tarball } = await fixture();
    try {
      const archive = await pack(tarball, src, 'gnu', true);
      await extractTarFile(archive, join(tarball, 'out'));

      // A gzipped archive is expanded to a sibling .tar first; it must be gone,
      // otherwise a JDK install leaves a ~350 MB file in the user's directory.
      expect(readdirSync(tarball).sort()).toEqual(['archive-gnu.tar.gz', 'out', 'src']);
    } finally {
      await rm(tarball, { recursive: true, force: true });
    }
  });
});