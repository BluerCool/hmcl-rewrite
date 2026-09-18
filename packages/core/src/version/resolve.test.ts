import { describe, expect, it } from 'vitest';
import { resolveVersion, uniqueLibraries } from './resolve.js';
import { Library } from './library.js';
import type { GameVersionJson } from './types.js';

const parentManifest: GameVersionJson = {
  id: '1.20.1',
  mainClass: 'net.minecraft.client.main.Main',
  minecraftArguments: '--username ${auth_player_name}',
  arguments: {
    game: ['--gameParent'],
    jvm: ['-Dparent.jvm=true']
  },
  assets: '5',
  libraries: [
    { name: 'com.google.guava:guava:17.0' },
    { name: 'org.lwjgl:lwjgl:3.2.2', rules: [{ action: 'allow', os: { name: 'linux' } }] }
  ]
};

const childManifest: GameVersionJson = {
  id: 'forge-1.20.1',
  inheritsFrom: '1.20.1',
  mainClass: 'net.minecraftforge.bootstrap.BootstrapLauncher',
  libraries: [{ name: 'net.minecraftforge:forge:1.20.1' }]
};

function lookup(id: string): GameVersionJson | undefined {
  if (id === '1.20.1') return parentManifest;
  if (id === 'forge-1.20.1') return childManifest;
  if (id === 'cyclic-a') return { id, inheritsFrom: 'cyclic-b' };
  if (id === 'cyclic-b') return { id, inheritsFrom: 'cyclic-a' };
  return undefined;
}

describe('resolveVersion', () => {
  it('merges scalar fields with child precedence', () => {
    const resolved = resolveVersion('forge-1.20.1', lookup);
    expect(resolved.id).toBe('forge-1.20.1');
    expect(resolved.mainClass).toBe('net.minecraftforge.bootstrap.BootstrapLauncher');
    // Child has no minecraftArguments: parent's survives.
    expect(resolved.minecraftArguments).toBe('--username ${auth_player_name}');
    // No explicit jar anywhere: falls back to the deepest inheritsFrom target.
    expect(resolved.jar).toBe('1.20.1');
  });

  it('concatenates argument lists with parent first', () => {
    const resolved = resolveVersion('forge-1.20.1', lookup);
    expect(resolved.arguments?.jvm).toEqual(['-Dparent.jvm=true']);
    expect(resolved.arguments?.game).toEqual(['--gameParent']);
  });

  it('concatenates libraries with child first and dedups by coordinates', () => {
    const resolved = resolveVersion('forge-1.20.1', lookup);
    const descriptors = resolved.libraries.map((library) => library.artifact.descriptor);
    expect(descriptors).toContain('net.minecraftforge:forge:1.20.1');
    expect(descriptors).toContain('com.google.guava:guava:17.0');
  });

  it('throws on missing parents', () => {
    expect(() => resolveVersion('ghost', lookup)).toThrow(/Missing version manifest/);
  });
});

describe('uniqueLibraries', () => {
  it('keeps the higher version of the same group:artifact', () => {
    const deduped = uniqueLibraries([
      new Library({ name: 'org.ow2.asm:asm:9.0' }),
      new Library({ name: 'org.ow2.asm:asm:9.7' })
    ]);
    expect(deduped).toHaveLength(1);
    expect(deduped[0]?.version).toBe('9.7');
  });

  it('coexists same-version libraries that differ as objects', () => {
    const deduped = uniqueLibraries([
      new Library({
        name: 'com.mojang:text2speech:1.11.3',
        downloads: { artifact: { url: 'https://example.com/a.jar' } }
      }),
      new Library({
        name: 'com.mojang:text2speech:1.11.3',
        natives: { linux: 'natives-linux' }
      })
    ]);
    expect(deduped).toHaveLength(2);
  });

  it('treats different rules as distinct platform variants', () => {
    const deduped = uniqueLibraries([
      new Library({ name: 'ca.weblite:java-objc-bridge:1.0.0' }),
      new Library({
        name: 'ca.weblite:java-objc-bridge:1.0.0',
        rules: [{ action: 'allow', os: { name: 'osx' } }]
      })
    ]);
    expect(deduped).toHaveLength(2);
  });
});
