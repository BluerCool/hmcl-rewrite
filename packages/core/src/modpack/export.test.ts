import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unzipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GameRepository } from '../game/repository.js';
import type { GameVersionJson } from '../version/types.js';
import {
  buildModrinthIndex,
  exportModrinthMrpack,
  isExcludedFromExport,
  loaderDependencyOf,
  suggestedExportInfo
} from './export.js';

describe('isExcludedFromExport', () => {
  it('keeps the files a pack is made of', () => {
    for (const path of [
      'mods/example.jar',
      'config/example.toml',
      'resourcepacks/pack.zip',
      'shaderpacks/complementary.zip',
      'defaultconfigs/common.toml',
      'kubejs/server.js',
      'mods/nested/sub/mod.jar'
    ]) {
      expect(isExcludedFromExport(path), path).toBe(false);
    }
  });

  it('drops logs, caches and launcher bookkeeping', () => {
    for (const path of [
      'logs/latest.log',
      'crash-reports/crash-2024.txt',
      'usernamecache.json',
      'options.txt',
      'saves/world1/level.dat',
      'launcher_profiles.json',
      '.fabric/remapped',
      'jars/some.jar',
      'backups/old.zip',
      'CustomSkinLoader/caches/x.dat',
      'modrinth.index.json',
      'mods/example.jar.old',
      'servers.dat_old'
    ]) {
      expect(isExcludedFromExport(path), path).toBe(true);
    }
  });

  it('drops a whole directory listed by name', () => {
    expect(isExcludedFromExport('natives/libglfw.so')).toBe(true);
    expect(isExcludedFromExport('data/x.dat')).toBe(true);
    expect(isExcludedFromExport('journeymap/data/waypoints.map')).toBe(true);
  });

  it('drops the architecture-suffixed natives folder this launcher writes', () => {
    // `GameRepository.nativesDir` appends os/arch, so HMCL's plain `natives`
    // entry would not match and the binaries would ship inside the pack.
    expect(isExcludedFromExport('natives-linux-x86_64/libglfw.so')).toBe(true);
    expect(isExcludedFromExport('natives-macos-arm64/libglfw.dylib')).toBe(true);
    expect(isExcludedFromExport('config/natives-linux-x86_64.toml')).toBe(false);
  });

  it('does not match a bare prefix as a directory', () => {
    // `saves` must not exclude a differently named top-level entry.
    expect(isExcludedFromExport('savesx/level.dat')).toBe(false);
    expect(isExcludedFromExport('config/natives')).toBe(false);
  });
});

describe('loaderDependencyOf', () => {
  const manifest = (id: string, extra: Partial<GameVersionJson> = {}): GameVersionJson => ({
    id,
    ...extra
  });

  it('prefers what the modpack manifest declared', () => {
    const source = manifest('pack', {
      type: 'modpack',
      modpackInfo: {
        versionId: '1.0.0',
        dependencies: { minecraft: '1.21.1', 'fabric-loader': '0.16.3' }
      }
    });
    expect(loaderDependencyOf(source, [source])).toEqual({ key: 'fabric-loader', version: '0.16.3' });
  });

  it('falls back to the library scan when there is no modpack manifest', () => {
    const forge = manifest('1.20.1-forge-47.4.10', {
      libraries: [{ name: 'net.minecraftforge:fmlloader:1.20.1-47.4.10' }]
    });
    const chain = [forge, manifest('1.20.1')];
    expect(loaderDependencyOf(forge, chain)).toEqual({ key: 'forge', version: '1.20.1-47.4.10' });
  });

  it('reports nothing for a vanilla chain', () => {
    const vanilla = manifest('1.21.1');
    expect(loaderDependencyOf(vanilla, [vanilla])).toBeUndefined();
  });
});

describe('buildModrinthIndex', () => {
  it('states the game version, the loader and an empty file list', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hmcl-export-'));
    try {
      const repo = new GameRepository(root);
      await writeVersion(repo, '1.21.1', {});
      await writeVersion(repo, 'fabric-loader-0.16.3-1.21.1', {
        inheritsFrom: '1.21.1',
        libraries: [{ name: 'net.fabricmc:fabric-loader:0.16.3' }]
      });
      const index = await buildModrinthIndex(repo, 'fabric-loader-0.16.3-1.21.1', {
        name: 'My Pack',
        version: '2.0.0',
        summary: 'a pack'
      });
      expect(index).toEqual({
        formatVersion: 1,
        game: 'minecraft',
        versionId: '2.0.0',
        name: 'My Pack',
        summary: 'a pack',
        files: [],
        dependencies: { minecraft: '1.21.1', 'fabric-loader': '0.16.3' }
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('omits the optional fields when they were left blank', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hmcl-export-'));
    try {
      const repo = new GameRepository(root);
      await writeVersion(repo, '1.21.1', {});
      const index = await buildModrinthIndex(repo, '1.21.1', {
        name: '1.21.1',
        version: '1.0.0',
        summary: ''
      });
      expect(index.summary).toBeUndefined();
      expect(index.dependencies).toEqual({ minecraft: '1.21.1' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('exportModrinthMrpack', () => {
  let root = '';
  let repo: GameRepository;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'hmcl-export-'));
    repo = new GameRepository(root);
    await writeVersion(repo, '1.21.1', {});
    await writeVersion(repo, 'fabric-loader-0.16.3-1.21.1', {
      inheritsFrom: '1.21.1',
      libraries: [{ name: 'net.fabricmc:fabric-loader:0.16.3' }]
    });
    const run = repo.versionRoot('fabric-loader-0.16.3-1.21.1');
    await mkdir(join(run, 'mods'), { recursive: true });
    await mkdir(join(run, 'config'), { recursive: true });
    await mkdir(join(run, 'saves', 'world1'), { recursive: true });
    await mkdir(join(run, 'logs'), { recursive: true });
    await writeFile(join(run, 'mods', 'jei.jar'), 'jar bytes');
    await writeFile(join(run, 'config', 'jei.json'), '{}');
    await writeFile(join(run, 'saves', 'world1', 'level.dat'), 'world');
    await writeFile(join(run, 'logs', 'latest.log'), 'noise');
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const runDir = (): string => repo.versionRoot('fabric-loader-0.16.3-1.21.1');

  it('writes a readable archive with the index and the overrides', async () => {
    const target = join(root, 'out.mrpack');
    const result = await exportModrinthMrpack(repo, 'fabric-loader-0.16.3-1.21.1', runDir(), {
      name: 'My Pack',
      version: '2.0.0',
      summary: undefined
    }, target);

    const entries = unzipSync(new Uint8Array(await readFile(target)));
    expect(Object.keys(entries).sort()).toEqual([
      'client-overrides/config/jei.json',
      'client-overrides/mods/jei.jar',
      'modrinth.index.json'
    ]);
    expect(new TextDecoder().decode(entries['client-overrides/mods/jei.jar'])).toBe('jar bytes');
    expect(JSON.parse(new TextDecoder().decode(entries['modrinth.index.json']))).toEqual({
      formatVersion: 1,
      game: 'minecraft',
      versionId: '2.0.0',
      name: 'My Pack',
      files: [],
      dependencies: { minecraft: '1.21.1', 'fabric-loader': '0.16.3' }
    });
    expect(result.files).toBe(2);
    expect(result.bytes).toBeGreaterThan(0);
    expect(result.skipped).toContain('logs/latest.log');
    expect(result.skipped).toContain('saves/world1/level.dat');
  });

  it('honours an explicit file list instead of the blacklist', async () => {
    const target = join(root, 'picked.mrpack');
    await exportModrinthMrpack(
      repo,
      'fabric-loader-0.16.3-1.21.1',
      runDir(),
      { name: 'P', version: '1', summary: undefined },
      target,
      ['mods/jei.jar']
    );
    const entries = unzipSync(new Uint8Array(await readFile(target)));
    expect(Object.keys(entries).sort()).toEqual([
      'client-overrides/mods/jei.jar',
      'modrinth.index.json'
    ]);
  });

  it('refuses to write an index-only pack when the run directory is missing', async () => {
    // Swallowing this would hand back a valid-looking archive with no mods in
    // it, which reads as "this instance has nothing to export".
    await expect(
      exportModrinthMrpack(
        repo,
        '1.21.1',
        join(root, 'does-not-exist'),
        { name: 'P', version: '1', summary: undefined },
        join(root, 'empty.mrpack')
      )
    ).rejects.toThrow(/无法读取实例目录/);
    await expect(readFile(join(root, 'empty.mrpack'))).rejects.toThrow();
  });
});

describe('suggestedExportInfo', () => {
  it('reuses the modpack name and version when the instance came from one', () => {
    expect(
      suggestedExportInfo(
        {
          format: 'modrinth',
          name: 'UKUS PVP',
          version: '1.5.7',
          summary: 'pvp',
          gameVersion: '1.21.1',
          loader: undefined
        },
        'ukuspvpmodpack'
      )
    ).toEqual({ name: 'UKUS PVP', version: '1.5.7', summary: 'pvp' });
  });

  it('falls back to the instance id and version 1.0.0', () => {
    expect(suggestedExportInfo(undefined, '1.21.1')).toEqual({
      name: '1.21.1',
      version: '1.0.0',
      summary: undefined
    });
  });
});

/** Writes a `versions/<id>/<id>.json` manifest the repository can scan. */
async function writeVersion(
  repo: GameRepository,
  id: string,
  manifest: Partial<GameVersionJson>
): Promise<void> {
  await mkdir(repo.versionRoot(id), { recursive: true });
  await writeFile(repo.versionJson(id), JSON.stringify({ id, type: 'release', ...manifest }), 'utf8');
}