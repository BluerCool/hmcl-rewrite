import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  isPackCompatible,
  packCompatibilityNote,
  readPackMetadata,
  requiredResourceFormat
} from './pack-format.js';
import { GameRepository } from './repository.js';

let root: string;
let repo: GameRepository;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'hmcl-packfmt-'));
  repo = new GameRepository(root);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** Writes a zip holding just a pack.mcmeta with the given `pack` section. */
async function packZip(name: string, pack: unknown): Promise<string> {
  const path = join(root, name);
  const data = zipSync({ 'pack.mcmeta': strToU8(JSON.stringify({ pack })) });
  await writeFile(path, data);
  return path;
}

/** Writes a version jar whose version.json declares a pack_version. */
async function versionJar(id: string, packVersion: unknown): Promise<void> {
  const dir = repo.versionRoot(id);
  await mkdir(dir, { recursive: true });
  await writeFile(
    repo.versionJar(id),
    zipSync({ 'version.json': strToU8(JSON.stringify({ pack_version: packVersion })) })
  );
}

describe('reading pack metadata', () => {
  it('reads pack_format', async () => {
    expect(await readPackMetadata(await packZip('a.zip', { pack_format: 34 }))).toEqual({ packFormat: 34 });
  });

  it('reads a supported_formats range', async () => {
    const meta = await readPackMetadata(
      await packZip('b.zip', { pack_format: 15, supported_formats: { min_inclusive: 15, max_inclusive: 40 } })
    );
    expect(meta?.supportedFormats).toEqual({ minInclusive: 15, maxInclusive: 40 });
  });

  it('ignores a non-standard supported_formats array, which no client reads', async () => {
    const meta = await readPackMetadata(await packZip('c.zip', { pack_format: 8, supported_formats: [8, 99] }));
    expect(meta?.supportedFormats).toBeUndefined();
  });

  it('reads the 26.x min_format/max_format scheme', async () => {
    const meta = await readPackMetadata(await packZip('d.zip', { min_format: [75, 0], max_format: [2147483647, 0] }));
    expect(meta).toEqual({ minFormat: 75, maxFormat: 2147483647 });
  });

  it('reports nothing for a file that is not a pack', async () => {
    const path = join(root, 'broken.zip');
    await writeFile(path, 'not a zip at all');
    expect(await readPackMetadata(path)).toBeUndefined();
  });

  it('reports nothing when pack.mcmeta is absent', async () => {
    const path = join(root, 'empty.zip');
    await writeFile(path, zipSync({ 'assets/minecraft/note.txt': strToU8('hi') }));
    expect(await readPackMetadata(path)).toBeUndefined();
  });
});

describe('the format a game expects', () => {
  it('reads the plain resource field', async () => {
    await versionJar('1.21.1', { resource: 34, data: 48 });
    expect(await requiredResourceFormat(repo, '1.21.1')).toBe(34);
  });

  it('reads the major field newer versions use', async () => {
    await versionJar('26.2', { resource_major: 88, resource_minor: 0 });
    expect(await requiredResourceFormat(repo, '26.2')).toBe(88);
  });

  it('claims nothing when there is no jar', async () => {
    expect(await requiredResourceFormat(repo, 'missing')).toBeUndefined();
  });

  it('follows inheritsFrom to the jar a modpack instance runs', async () => {
    // A modpack instance has no jar of its own; the game resolves the inherited
    // one, and so must the compatibility check.
    await versionJar('1.21.1', { resource: 34, data: 48 });
    await mkdir(repo.versionRoot('modpack'), { recursive: true });
    await writeFile(
      join(repo.versionRoot('modpack'), 'modpack.json'),
      JSON.stringify({ id: 'modpack', inheritsFrom: '1.21.1', libraries: [], mainClass: '' })
    );
    expect(await requiredResourceFormat(repo, 'modpack')).toBe(34);
  });

  it('stops instead of looping on a broken inheritance chain', async () => {
    await versionJar('a', { resource: 34 });
    await mkdir(repo.versionRoot('b'), { recursive: true });
    await writeFile(
      join(repo.versionRoot('b'), 'b.json'),
      JSON.stringify({ id: 'b', inheritsFrom: 'a', libraries: [], mainClass: '' })
    );
    await writeFile(
      join(repo.versionRoot('a'), 'a.json'),
      JSON.stringify({ id: 'a', inheritsFrom: 'b', libraries: [], mainClass: '' })
    );
    expect(await requiredResourceFormat(repo, 'b')).toBe(34);
  });
});

describe('deciding whether the game would load a pack', () => {
  // The cases are taken from packs that actually turned up in this installer's
  // resourcepacks folder, where each one looked fine in the download list.
  it('accepts a pack matching the game exactly', () => {
    expect(isPackCompatible({ packFormat: 34 }, 34)).toBe(true);
  });

  it('accepts a pack whose supported_formats covers the game', () => {
    expect(isPackCompatible({ packFormat: 15, supportedFormats: { minInclusive: 15, maxInclusive: 40 } }, 34)).toBe(true);
  });

  it('rejects an empty or inverted supported_formats range', () => {
    // Faithful 32x ships exactly this for its 1.21.1 file.
    expect(isPackCompatible({ supportedFormats: { minInclusive: 34, maxInclusive: 33 } }, 34)).toBe(false);
  });

  it('rejects a pack built for a newer game', () => {
    expect(isPackCompatible({ packFormat: 13 }, 34)).toBe(false);
    expect(isPackCompatible({ packFormat: 97 }, 34)).toBe(false);
  });

  it('rejects a pack that only declares the post-1.21.9 scheme', () => {
    expect(isPackCompatible({ minFormat: 75, maxFormat: 2147483647 }, 34)).toBe(false);
  });

  it('says nothing it cannot prove', () => {
    expect(isPackCompatible(undefined, 34)).toBe(true);
    expect(isPackCompatible({ packFormat: 13 }, undefined)).toBe(true);
  });
});

describe('explaining the verdict', () => {
  it('names both formats when they differ', () => {
    expect(packCompatibilityNote({ packFormat: 13 }, 34)).toBe(
      '这个包声明的格式 13，你的游戏需要 34，游戏会拒绝加载它'
    );
  });

  it('calls out the newer scheme explicitly', () => {
    expect(packCompatibilityNote({ minFormat: 75, maxFormat: 2147483647 }, 34)).toContain('新版格式写法');
  });

  it('has nothing to say about a usable pack', () => {
    expect(packCompatibilityNote({ packFormat: 34 }, 34)).toBeUndefined();
  });
});
