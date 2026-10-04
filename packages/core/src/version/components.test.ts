import { describe, expect, it } from 'vitest';
import { resolveLoaderComponents } from './components.js';
import type { GameVersionJson } from './types.js';

/** A chain stub: one manifest per id, each with the given library names. */
function chain(entries: Array<{ id: string; inheritsFrom?: string; libraries: string[] }>): GameVersionJson[] {
  return entries.map((entry) => ({
    id: entry.id,
    ...(entry.inheritsFrom === undefined ? {} : { inheritsFrom: entry.inheritsFrom }),
    libraries: entry.libraries.map((name) => ({ name }))
  }));
}

describe('resolveLoaderComponents', () => {
  it('reads Forge 1.21 from the fmlcore artifact and drops the game-version prefix', () => {
    // Real coordinates from a 1.21 Forge install.
    const found = resolveLoaderComponents(
      chain([
        {
          id: '1.21-forge-51.0.33',
          inheritsFrom: '1.21',
          libraries: [
            'net.minecraftforge:forge:1.21-51.0.33:universal',
            'net.minecraftforge:fmlcore:1.21-51.0.33',
            'net.minecraftforge:fmlloader:1.21-51.0.33'
          ]
        },
        { id: '1.21', libraries: ['com.mojang:blocklist:1.0.10'] }
      ]),
      '1.21'
    );
    expect(found).toEqual([{ slug: 'forge', label: 'Forge', version: '51.0.33' }]);
  });

  it('reads Forge 1.20.1 from fmlloader, the only marker that install ships', () => {
    const found = resolveLoaderComponents(
      chain([
        {
          id: '1.20.1-forge-47.4.10',
          inheritsFrom: '1.20.1',
          libraries: [
            'net.minecraftforge:accesstransformers:8.0.4',
            'net.minecraftforge:forgespi:7.0.1',
            'net.minecraftforge:fmlloader:1.20.1-47.4.10'
          ]
        },
        { id: '1.20.1', libraries: [] }
      ]),
      '1.20.1'
    );
    expect(found).toEqual([{ slug: 'forge', label: 'Forge', version: '47.4.10' }]);
  });

  it('reads a bare Fabric loader version', () => {
    const found = resolveLoaderComponents(
      chain([{ id: 'fabric-loader-0.16.3-1.21.1', libraries: ['net.fabricmc:fabric-loader:0.16.3'] }]),
      '1.21.1'
    );
    expect(found).toEqual([{ slug: 'fabric', label: 'Fabric', version: '0.16.3' }]);
  });

  it('names NeoForge without a version when the manifest carries no neoforge artifact', () => {
    // A real NeoForge version json: only net.neoforged:* support libraries.
    const found = resolveLoaderComponents(
      chain([
        {
          id: 'neoforge-21.0.167',
          inheritsFrom: '1.21',
          libraries: [
            'net.neoforged:JarJarFileSystems:0.4.1@jar',
            'net.neoforged:coremods:7.0.3@jar',
            'net.neoforged.fancymodloader:loader:4.0.23@jar',
            'net.minecraftforge:srgutils:0.4.15@jar'
          ]
        },
        { id: '1.21', libraries: [] }
      ]),
      '1.21'
    );
    expect(found).toEqual([{ slug: 'neoforge', label: 'NeoForge', version: undefined }]);
  });

  it('prefers NeoForge over the net.minecraftforge support artifact it also ships', () => {
    const found = resolveLoaderComponents(
      chain([
        {
          id: 'neoforge-x',
          libraries: ['net.minecraftforge:srgutils:0.4.15@jar', 'net.neoforged:neoforge:21.0.167']
        }
      ]),
      '1.21'
    );
    expect(found.map((entry) => entry.slug)).toEqual(['neoforge']);
  });

  it('finds a loader the instance only inherits, as a modpack does', () => {
    const found = resolveLoaderComponents(
      chain([
        { id: 'ukuspvpmodpack', inheritsFrom: 'fabric-loader-0.16.14-1.21', libraries: [] },
        { id: 'fabric-loader-0.16.14-1.21', inheritsFrom: '1.21', libraries: ['net.fabricmc:fabric-loader:0.16.14'] },
        { id: '1.21', libraries: [] }
      ]),
      '1.21'
    );
    expect(found).toEqual([{ slug: 'fabric', label: 'Fabric', version: '0.16.14' }]);
  });

  it('leaves vanilla instances with no loader at all', () => {
    const found = resolveLoaderComponents(
      chain([{ id: '1.21.1', libraries: ['com.mojang:blocklist:1.0.10', 'org.lwjgl:lwjgl:3.3.3'] }]),
      '1.21.1'
    );
    expect(found).toEqual([]);
  });

  it('still names a loader whose coordinate carries no readable version', () => {
    const found = resolveLoaderComponents(
      chain([{ id: 'x', libraries: ['net.fabricmc:fabric-loader:', 'org.quiltmc:quilt-loader'] }]),
      undefined
    );
    expect(found).toEqual([
      { slug: 'fabric', label: 'Fabric', version: undefined },
      { slug: 'quilt', label: 'Quilt', version: undefined }
    ]);
  });

  it('fills in a version from a later library when the first marker has none', () => {
    const found = resolveLoaderComponents(
      chain([
        {
          id: 'x',
          libraries: ['net.neoforged:coremods:7.0.3@jar', 'net.neoforged:neoforge:21.0.167']
        }
      ]),
      '1.21'
    );
    expect(found).toEqual([{ slug: 'neoforge', label: 'NeoForge', version: '21.0.167' }]);
  });

  it('keeps the most severe loader first when an instance somehow has two', () => {
    const found = resolveLoaderComponents(
      chain([{ id: 'x', libraries: ['net.fabricmc:fabric-loader:0.16.3', 'net.minecraftforge:fmlloader:1.21-51.0.33'] }]),
      '1.21'
    );
    expect(found.map((entry) => entry.slug)).toEqual(['forge', 'fabric']);
  });
});
