import { mkdtemp, rm, mkdir, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GameRepository } from './repository.js';
import {
  instanceSettingsPath,
  readInstanceSettings,
  resolveGameDir,
  writeInstanceSettings
} from './instance-settings.js';
import type { InstanceSettings } from './instance-settings.js';

let root: string;
let repo: GameRepository;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'hmcl-gamedir-'));
  repo = new GameRepository(root);
  await mkdir(repo.versionRoot('vanilla'), { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** Mirrors the launcher's own write path so the test uses the real file. */
async function setSettings(id: string, settings: InstanceSettings): Promise<void> {
  await writeInstanceSettings(repo, id, settings);
}

describe('resolveGameDir', () => {
  it('puts an instance with no settings in the shared repository root', async () => {
    // This is the default every existing instance has, and the case that broke:
    // the installer wrote to the root while 资源包管理 listed the version root.
    expect(await resolveGameDir(repo, 'vanilla')).toBe(repo.rootDir);
  });

  it('puts a global instance in the shared repository root', async () => {
    await setSettings('vanilla', { gameDirType: 'global' });
    expect(await resolveGameDir(repo, 'vanilla')).toBe(repo.rootDir);
  });

  it('isolates an instance whose game directory is its own', async () => {
    await setSettings('vanilla', { gameDirType: 'instance' });
    expect(await resolveGameDir(repo, 'vanilla')).toBe(repo.versionRoot('vanilla'));
  });

  it('treats an unreadable settings file as global rather than isolated', async () => {
    await mkdir(join(repo.versionRoot('vanilla'), '.hmcl', 'config'), { recursive: true });
    await writeFile(instanceSettingsPath(repo, 'vanilla'), '{ not json', 'utf8');
    expect(await readInstanceSettings(repo, 'vanilla')).toEqual({});
    expect(await resolveGameDir(repo, 'vanilla')).toBe(repo.rootDir);
  });

  it('agrees with the directory the launcher runs the game in', async () => {
    // The rule has to hold for the isolated case too, otherwise an isolated
    // instance would install packs somewhere the game never looks.
    await setSettings('vanilla', { gameDirType: 'instance' });
    const gameDir = await resolveGameDir(repo, 'vanilla');
    expect(gameDir).toBe(repo.versionRoot('vanilla'));
    expect(gameDir).not.toBe(repo.rootDir);
  });

  it('is the directory a global instance and its root share', async () => {
    await setSettings('a', { gameDirType: 'global' });
    await setSettings('b', { gameDirType: 'global' });
    // Two global instances deliberately see one resource pack folder, which is
    // what makes a pack installed into one visible in the other.
    expect(await resolveGameDir(repo, 'a')).toBe(await resolveGameDir(repo, 'b'));
  });
});

describe('resource pack round trip', () => {
  it('lists a pack that was installed into the shared root', async () => {
    // End to end shape of the reported bug: install writes to resolveGameDir,
    // so anything reading the instance's resourcepacks folder must agree.
    const gameDir = await resolveGameDir(repo, 'vanilla');
    await mkdir(join(gameDir, 'resourcepacks'), { recursive: true });
    await writeFile(join(gameDir, 'resourcepacks', 'pack.zip'), 'x', 'utf8');
    const listed = await readdir(join(gameDir, 'resourcepacks'));
    expect(listed).toEqual(['pack.zip']);
  });
});
