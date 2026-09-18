import { describe, expect, it } from 'vitest';
import { Library } from './library.js';
import { rulesAllow } from './rules.js';
import type { RuleJson } from './types.js';

describe('rulesAllow', () => {
  it('allows when no rules are present', () => {
    expect(rulesAllow(undefined)).toBe(true);
    expect(rulesAllow([])).toBe(true);
  });

  it('applies the last matching rule', () => {
    const rules: RuleJson[] = [
      { action: 'allow', os: { name: 'windows' } },
      { action: 'disallow', os: { name: 'linux' } }
    ];
    // On linux the second rule applies and disallows.
    expect(rulesAllow(rules)).toBe(false);
  });

  it('requires all feature flags to match', () => {
    const rules: RuleJson[] = [{ action: 'allow', features: { has_custom_resolution: true } }];
    expect(rulesAllow(rules, { has_custom_resolution: true })).toBe(true);
    expect(rulesAllow(rules, {})).toBe(false);
  });
});

describe('Library natives', () => {
  it('selects classifier from the natives map with ${arch} substitution', () => {
    const library = new Library({
      name: 'org.lwjgl:lwjgl:3.2.2',
      natives: { linux: 'natives-linux-${arch}' },
      downloads: {
        classifiers: { 'natives-linux-64': { url: 'https://example.com/n.jar' } }
      }
    });
    expect(library.isNative()).toBe(true);
    expect(library.nativeClassifier()).toMatch(/^natives-linux-(32|64)$/);
  });

  it('is not native without natives metadata', () => {
    const library = new Library({ name: 'com.google.guava:guava:17.0' });
    expect(library.isNative()).toBe(false);
    expect(library.nativeClassifier()).toBeUndefined();
  });

  it('builds download info from downloads.artifact', () => {
    const library = new Library({
      name: 'com.google.guava:guava:17.0',
      downloads: {
        artifact: {
          path: 'com/google/guava/guava/17.0/guava-17.0.jar',
          url: 'https://libraries.minecraft.net/com/google/guava/guava/17.0/guava-17.0.jar',
          sha1: 'abc'
        }
      }
    });
    const info = library.downloadInfo();
    expect(info.sha1).toBe('abc');
    expect(info.path).toBe('com/google/guava/guava/17.0/guava-17.0.jar');
  });

  it('falls back to maven layout against the custom repository url', () => {
    const library = new Library({
      name: 'net.minecraftforge:forge:1.20.1:universal',
      url: 'https://maven.minecraftforge.net/'
    });
    const info = library.downloadInfo();
    expect(info.url).toBe(
      'https://maven.minecraftforge.net/net/minecraftforge/forge/1.20.1/forge-1.20.1-universal.jar'
    );
  });
});
