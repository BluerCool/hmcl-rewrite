import { describe, expect, it } from 'vitest';
import { modpackSourceOf } from './source.js';

describe('modpackSourceOf', () => {
  it('reads a Modrinth index kept by the installer', () => {
    const source = modpackSourceOf({
      id: 'ukuspvpmodpack',
      type: 'modpack',
      modpackInfo: {
        formatVersion: 1,
        game: 'minecraft',
        versionId: '1.0.0',
        name: 'UKUS PVP Modpack',
        summary: 'A pvp modpack',
        files: [{ path: 'mods/ukuspvp.jar', downloads: ['https://example/ukuspvp.jar'] }],
        dependencies: { minecraft: '1.21.1', 'fabric-loader': '0.16.3' }
      }
    });
    expect(source).toEqual({
      format: 'modrinth',
      name: 'UKUS PVP Modpack',
      version: '1.0.0',
      summary: 'A pvp modpack',
      gameVersion: '1.21.1',
      loader: { key: 'fabric-loader', version: '0.16.3' },
      projectId: undefined
    });
  });

  it('reads the origin project the installer recorded beside the manifest', () => {
    const source = modpackSourceOf({
      id: 'ukuspvpmodpack',
      type: 'modpack',
      modpackOrigin: { projectId: 'JR0bkFKa' },
      modpackInfo: {
        formatVersion: 1,
        game: 'minecraft',
        versionId: '1.5.7+mc1.21.1',
        name: 'ukus-pvp-modpack',
        files: [],
        dependencies: { minecraft: '1.21.1' }
      }
    });
    expect(source?.projectId).toBe('JR0bkFKa');
    expect(source?.version).toBe('1.5.7+mc1.21.1');
  });

  it('reports no project for a pack imported from a local file', () => {
    // The manifest alone can never name its project, so an instance installed
    // from a local .mrpack is permanently un-updatable from the list.
    const source = modpackSourceOf({
      id: 'local',
      modpackInfo: { versionId: '1.0', name: 'local', dependencies: { minecraft: '1.21' } }
    });
    expect(source?.projectId).toBeUndefined();
  });

  it('reads a CurseForge manifest, whose version field is named differently', () => {
    const source = modpackSourceOf({
      id: 'cf-pack',
      type: 'modpack',
      modpackInfo: {
        manifestType: 'minecraftModpack',
        manifestVersion: 1,
        name: 'CF Pack',
        version: '2.1',
        files: [{ projectID: 1, fileID: 2, required: true }],
        overrides: 'overrides',
        minecraft: { version: '1.20.1', modLoaders: [{ id: 'forge-47.4.10', primary: true }] }
      }
    });
    expect(source).toEqual({
      format: 'curseforge',
      name: 'CF Pack',
      version: '2.1',
      summary: undefined,
      gameVersion: '1.20.1',
      loader: { key: 'forge', version: '47.4.10' },
      projectId: undefined
    });
  });

  it('maps a CurseForge `<loader>-<version>` id onto the Modrinth dependency key', () => {
    const source = modpackSourceOf({
      id: 'x',
      modpackInfo: {
        version: '1',
        minecraft: { version: '1.20.1', modLoaders: [{ id: 'fabric-0.16.3', primary: true }] }
      }
    });
    expect(source?.loader).toEqual({ key: 'fabric-loader', version: '0.16.3' });
  });

  it('does not read neoforge- as forge-', () => {
    const source = modpackSourceOf({
      id: 'x',
      modpackInfo: { version: '1', minecraft: { version: '1.21', modLoaders: [{ id: 'neoforge-21.0.167' }] } }
    });
    expect(source?.loader).toEqual({ key: 'neoforge', version: '21.0.167' });
  });

  it('skips the vanilla loader CurseForge always lists', () => {
    const source = modpackSourceOf({
      id: 'x',
      modpackInfo: {
        version: '1',
        minecraft: { version: '1.21', modLoaders: [{ id: 'minecraft-1.21' }, { id: 'fabric-0.16.3' }] }
      }
    });
    expect(source?.loader).toEqual({ key: 'fabric-loader', version: '0.16.3' });
  });

  it('says nothing for an instance that is not a modpack', () => {
    expect(modpackSourceOf({ id: '1.21.1', type: 'release' })).toBeUndefined();
    expect(modpackSourceOf({ id: 'x', modpackInfo: undefined })).toBeUndefined();
  });

  it('ignores a modpackInfo that names no version at all', () => {
    expect(modpackSourceOf({ id: 'x', modpackInfo: { name: 'nameless' } })).toBeUndefined();
    expect(modpackSourceOf({ id: 'x', modpackInfo: { versionId: '' } })).toBeUndefined();
  });

  it('falls back to the version when the manifest carries no name', () => {
    const source = modpackSourceOf({ id: 'x', modpackInfo: { versionId: '3.0' } });
    expect(source?.name).toBe('3.0');
  });

  it('reports no loader when the pack declares a vanilla chain', () => {
    const source = modpackSourceOf({
      id: 'x',
      modpackInfo: { versionId: '1', dependencies: { minecraft: '1.21' } }
    });
    expect(source?.loader).toBeUndefined();
  });
});
