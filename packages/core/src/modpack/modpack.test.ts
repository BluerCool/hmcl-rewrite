import { expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFile, rm } from 'node:fs/promises';
import { GameRepository } from '../game/repository.js';
import { extractOverrides, safeJoin } from './modpack.js';

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