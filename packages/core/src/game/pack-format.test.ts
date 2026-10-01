import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  isPackCompatible,
  packCompatibilityNote,
  readPackMetadata,
  requiredResourceFormat,
  supportedFormatRange
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

  it('reads a supported_formats object', async () => {
    const meta = await readPackMetadata(
      await packZip('b.zip', { pack_format: 15, supported_formats: { min_inclusive: 15, max_inclusive: 40 } })
    );
    expect(meta?.supportedFormats).toEqual({ min: 15, max: 40 });
  });

  it('reads the two-element supported_formats array form too', async () => {
    // Packs ship both spellings; HMCL reads both, so this must too.
    const meta = await readPackMetadata(await packZip('c.zip', { pack_format: 34, supported_formats: [18, 22] }));
    expect(meta?.supportedFormats).toEqual({ min: 18, max: 22 });
  });

  it('leaves out a supported_formats it cannot make sense of', async () => {
    const meta = await readPackMetadata(await packZip('c2.zip', { pack_format: 8, supported_formats: [8, 99, 100] }));
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
    expect(
      isPackCompatible({ packFormat: 15, supportedFormats: { min: 15, max: 40 } }, 34)
    ).toBe(true);
  });

  it('accepts the array form of supported_formats', () => {
    // "Low On Fire 26.2" as shipped: pack_format 15 plus a 15..200 range.
    expect(
      isPackCompatible(
        { packFormat: 15, supportedFormats: { min: 15, max: 200 }, minFormat: 15, maxFormat: 200 },
        34
      )
    ).toBe(true);
  });

  it('rejects a pack whose own fields contradict each other', () => {
    // "Low On Fire 1.21": pack_format 34 lines up with 1.21.1, but the pack
    // itself says it only serves 18..22. Taking pack_format at face value is how
    // this pack gets installed and then does nothing.
    expect(isPackCompatible({ packFormat: 34, supportedFormats: { min: 18, max: 22 } }, 34)).toBe(false);
  });

  it('rejects a range reaching past any real resource pack format', () => {
    // "Low On Fire 1.21.3" declares 1.21.1 support, then asks for 0..99.
    expect(isPackCompatible({ packFormat: 34, supportedFormats: { min: 0, max: 99 } }, 34)).toBe(false);
  });

  it('rejects an empty or inverted supported_formats range', () => {
    // Faithful 32x ships exactly this for its 1.21.1 file.
    expect(isPackCompatible({ supportedFormats: { min: 34, max: 33 } }, 34)).toBe(false);
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

  it('names the range the pack claims, not the field that looks right', () => {
    // The 18~22 is what the pack itself serves, so it is the honest thing to
    // show; the note that pack_format disagrees explains why 34 is not used.
    expect(packCompatibilityNote({ packFormat: 34, supportedFormats: { min: 18, max: 22 } }, 34)).toBe(
      '这个包声明的格式 18~22（声明与 pack_format 矛盾），你的游戏需要 34，游戏会拒绝加载它'
    );
  });

  it('calls out a format no released game ever used', () => {
    expect(packCompatibilityNote({ packFormat: 97 }, 34)).toContain('不是有效的资源包格式');
  });

  it('says when the pack contradicts itself', () => {
    expect(packCompatibilityNote({ packFormat: 8, supportedFormats: { min: 1, max: 2 } }, 34)).toContain(
      '声明与 pack_format 矛盾'
    );
  });
});

describe('the range a pack declares', () => {
  it('is just the one format when it claims nothing wider', () => {
    expect(supportedFormatRange({ packFormat: 34 })).toEqual({ min: 34, max: 34 });
  });

  it('takes the new scheme when min/max and supported_formats agree', () => {
    expect(
      supportedFormatRange({
        packFormat: 15,
        supportedFormats: { min: 15, max: 200 },
        minFormat: 15,
        maxFormat: 200
      })
    ).toEqual({ min: 15, max: 200 });
  });

  it('accepts a new-scheme max of 64 as "and everything newer"', () => {
    expect(
      supportedFormatRange({
        packFormat: 40,
        supportedFormats: { min: 40, max: 64 },
        minFormat: 40,
        maxFormat: 200
      })
    ).toEqual({ min: 40, max: 200 });
  });

  it('rejects a new-scheme range the supported_formats disagrees with', () => {
    expect(
      supportedFormatRange({
        packFormat: 15,
        supportedFormats: { min: 16, max: 200 },
        minFormat: 15,
        maxFormat: 200
      })
    ).toBeUndefined();
  });

  it('rejects an inverted new-scheme range', () => {
    expect(supportedFormatRange({ minFormat: 200, maxFormat: 15 })).toBeUndefined();
  });

  it('has no range to give for a pack with no metadata at all', () => {
    expect(supportedFormatRange(undefined)).toBeUndefined();
    expect(supportedFormatRange({})).toBeUndefined();
  });
});
