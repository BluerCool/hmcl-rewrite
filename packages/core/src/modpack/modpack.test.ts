import { expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { zipSync } from 'fflate';
import { GameRepository } from '../game/repository.js';
import type { DownloadProvider } from '../download/mirrors.js';
import { extractOverrides, installModpackFile, loaderFromModrinth, safeJoin } from './modpack.js';

it('loaderFromModrinth reads fabric-loader / quilt-loader dependency keys', () => {
  expect(
    loaderFromModrinth({
      formatVersion: 1,
      game: 'minecraft',
      versionId: '1.5.4+mc1.21.1',
      name: 'uku',
      files: [],
      dependencies: { minecraft: '1.21.1', 'fabric-loader': '0.16.3' }
    })
  ).toEqual({ kind: 'fabric', version: '0.16.3' });

  expect(
    loaderFromModrinth({
      formatVersion: 1,
      game: 'minecraft',
      versionId: 'x',
      name: 'x',
      files: [],
      dependencies: { minecraft: '1.21.1', 'quilt-loader': '0.27.0' }
    })
  ).toEqual({ kind: 'quilt', version: '0.27.0' });

  expect(
    loaderFromModrinth({
      formatVersion: 1,
      game: 'minecraft',
      versionId: 'x',
      name: 'x',
      files: [],
      dependencies: { minecraft: '1.21.1', forge: '52.0.1' }
    })
  ).toEqual({ kind: 'forge', version: '52.0.1' });

  expect(
    loaderFromModrinth({
      formatVersion: 1,
      game: 'minecraft',
      versionId: 'x',
      name: 'x',
      files: [],
      dependencies: { minecraft: '1.21.1' }
    })
  ).toBeUndefined();
});

it('extractOverrides extracts both overrides and client-overrides independently', async () => {
  const repo = new GameRepository(mkdtempSync(join(tmpdir(), 'hmcl-modpack-')));
  try {
    const entries: Record<string, Uint8Array> = {
      'overrides/config/options.txt': new TextEncoder().encode('foo=1'),
      'client-overrides/mods/client-only.jar': new Uint8Array([1, 2, 3]),
      'server-overrides/world/data.txt': new TextEncoder().encode('nope')
    };
    const lines: string[] = [];
    await extractOverrides(repo, 'Instance', entries, 'overrides', (line) => lines.push(line));
    await extractOverrides(repo, 'Instance', entries, 'client-overrides', (line) => lines.push(line));

    expect(await readFile(join(repo.versionRoot('Instance'), 'config/options.txt'), 'utf8')).toBe('foo=1');
    expect((await readFile(join(repo.versionRoot('Instance'), 'mods/client-only.jar'))).byteLength).toBe(3);
    await expect(readFile(join(repo.versionRoot('Instance'), 'world/data.txt'))).rejects.toThrow();
  } finally {
    await rm(repo.rootDir, { recursive: true, force: true });
  }
});

it('safeJoin refuses directory escapes', () => {
  const root = '/repo/versions/Instance';
  expect(safeJoin(root, 'config/options.txt')).toBe(`${root}/config/options.txt`);
  expect(() => safeJoin(root, '../other')).toThrow('非法路径');
  expect(() => safeJoin(root, 'a/../../evil')).toThrow('非法路径');
});

it('extractOverrides skips directory entries instead of writing to them', async () => {
  const repo = new GameRepository(mkdtempSync(join(tmpdir(), 'hmcl-modpack-')));
  try {
    const entries: Record<string, Uint8Array> = {
      'overrides/': new Uint8Array(0),
      'overrides/config/': new Uint8Array(0),
      'overrides/config/options.txt': new TextEncoder().encode('foo=1'),
      'overrides/mods/': new Uint8Array(0),
      'overrides/mods/example.jar': new Uint8Array([1, 2, 3]),
      '__MACOSX/._options.txt': new TextEncoder().encode('junk')
    };
    const lines: string[] = [];
    await extractOverrides(repo, 'Instance', entries, 'overrides', (line) => lines.push(line));

    expect(await readFile(join(repo.versionRoot('Instance'), 'config/options.txt'), 'utf8')).toBe('foo=1');
    expect((await readFile(join(repo.versionRoot('Instance'), 'mods/example.jar'))).byteLength).toBe(3);
    expect(lines.join()).toContain('已解压');
  } finally {
    await rm(repo.rootDir, { recursive: true, force: true });
  }
});
/** A provider that must never be reached: these tests download nothing. */
const OFFLINE_PROVIDER = {
  altUrls: () => [],
  concurrency: 1
} as unknown as DownloadProvider;

/**
 * Writes a Modrinth pack whose only dependency is an already-installed vanilla
 * version, so installing it needs no network.
 */
async function writeOfflineMrpack(
  repo: GameRepository,
  index: Record<string, unknown>,
  overrides: Record<string, string> = {}
): Promise<string> {
  const path = join(repo.rootDir, 'pack.mrpack');
  const entries: Record<string, Uint8Array> = {
    'modrinth.index.json': new TextEncoder().encode(JSON.stringify(index))
  };
  for (const [name, body] of Object.entries(overrides)) {
    entries[`overrides/${name}`] = new TextEncoder().encode(body);
  }
  await writeFile(path, zipSync(entries));
  return path;
}

it('installModpackFile records the origin project beside the manifest', async () => {
  const repo = new GameRepository(mkdtempSync(join(tmpdir(), 'hmcl-modpack-')));
  try {
    await mkdir(repo.versionRoot('1.21.1'), { recursive: true });
    await writeFile(repo.versionJson('1.21.1'), JSON.stringify({ id: '1.21.1', type: 'release' }));
    const zip = await writeOfflineMrpack(
      repo,
      {
        formatVersion: 1,
        game: 'minecraft',
        versionId: '3.0.0',
        name: 'offline pack',
        files: [],
        dependencies: { minecraft: '1.21.1' }
      },
      { 'config/options.txt': 'foo=1' }
    );

    const created = await installModpackFile(repo, OFFLINE_PROVIDER, zip, 'packed', {
      projectId: 'some-project'
    });
    expect(created).toBe('packed');

    const versionJson = JSON.parse(await readFile(repo.versionJson('packed'), 'utf8'));
    expect(versionJson.modpackOrigin).toEqual({ projectId: 'some-project' });
    // The manifest is the pack's own document and must stay untouched.
    expect(versionJson.modpackInfo.projectId).toBeUndefined();
    expect(versionJson.modpackInfo.versionId).toBe('3.0.0');
    expect(await readFile(join(repo.versionRoot('packed'), 'config/options.txt'), 'utf8')).toBe('foo=1');
  } finally {
    await rm(repo.rootDir, { recursive: true, force: true });
  }
});

it('installModpackFile writes no origin when the pack came from a local file', async () => {
  const repo = new GameRepository(mkdtempSync(join(tmpdir(), 'hmcl-modpack-')));
  try {
    await mkdir(repo.versionRoot('1.21.1'), { recursive: true });
    await writeFile(repo.versionJson('1.21.1'), JSON.stringify({ id: '1.21.1', type: 'release' }));
    const zip = await writeOfflineMrpack(repo, {
      formatVersion: 1,
      game: 'minecraft',
      versionId: '3.0.0',
      name: 'offline pack',
      files: [],
      dependencies: { minecraft: '1.21.1' }
    });
    await installModpackFile(repo, OFFLINE_PROVIDER, zip, 'packed');
    const versionJson = JSON.parse(await readFile(repo.versionJson('packed'), 'utf8'));
    expect(versionJson.modpackOrigin).toBeUndefined();
  } finally {
    await rm(repo.rootDir, { recursive: true, force: true });
  }
});

it('installModpackFile removes the instance directory when the install fails', async () => {
  const repo = new GameRepository(mkdtempSync(join(tmpdir(), 'hmcl-modpack-')));
  try {
    // No `dependencies.minecraft`, so the manifest is rejected after the instance
    // directory already exists — exactly the shape of a mid-install failure.
    const zip = await writeOfflineMrpack(repo, {
      formatVersion: 1,
      game: 'minecraft',
      versionId: '3.0.0',
      name: 'broken pack',
      files: [],
      dependencies: {}
    });
    await expect(installModpackFile(repo, OFFLINE_PROVIDER, zip, 'broken')).rejects.toThrow(
      /没有声明 Minecraft 版本/
    );
    // The directory itself has to be gone: a leftover one shows up in the
    // instance list as a broken pack. Checking version.json alone would pass
    // either way, since a failed install never writes it.
    await expect(stat(repo.versionRoot('broken'))).rejects.toThrow();
  } finally {
    await rm(repo.rootDir, { recursive: true, force: true });
  }
});
