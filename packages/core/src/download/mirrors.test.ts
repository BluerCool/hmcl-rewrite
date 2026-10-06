import { describe, expect, it } from 'vitest';
import {
  BMCLAPI_ROOT,
  BmclapiDownloadProvider,
  MOJANG_URLS,
  MojangDownloadProvider,
  createDownloadProvider
} from './mirrors.js';

describe('BmclapiDownloadProvider', () => {
  const provider = new BmclapiDownloadProvider();

  it('rewrites piston-meta onto the mirror root', () => {
    expect(
      provider.injectUrl('https://piston-meta.mojang.com/v1/packages/abc/1.20.1.json')
    ).toBe('https://bmclapi2.bangbang93.com/v1/packages/abc/1.20.1.json');
  });

  it('rewrites the client jar host', () => {
    expect(
      provider.injectUrl('https://piston-data.mojang.com/v1/objects/hash/client.jar')
    ).toBe('https://bmclapi2.bangbang93.com/v1/objects/hash/client.jar');
  });

  it('maps libraries.minecraft.net to /libraries', () => {
    expect(
      provider.injectUrl('https://libraries.minecraft.net/com/google/guava/guava/17.0/guava-17.0.jar')
    ).toBe(
      'https://bmclapi2.bangbang93.com/libraries/com/google/guava/guava/17.0/guava-17.0.jar'
    );
  });

  it('leaves unrelated URLs untouched', () => {
    expect(provider.injectUrl('https://example.com/file')).toBe('https://example.com/file');
  });

  it('exposes manifest and asset endpoints on the mirror', () => {
    expect(provider.versionManifestUrl).toBe(
      'https://bmclapi2.bangbang93.com/mc/game/version_manifest_v2.json'
    );
    expect(provider.assetBaseUrl).toBe('https://bmclapi2.bangbang93.com/assets/');
  });
});

describe('BmclapiDownloadProvider Modrinth fallback', () => {
  const provider = new BmclapiDownloadProvider();

  it('offers the Modrinth mirror as a fallback for CDN file URLs', () => {
    expect(
      provider.altUrls('https://cdn.modrinth.com/data/abc/versions/1/2/pack.mrpack')
    ).toEqual(['https://mod.mcimirror.top/data/abc/versions/1/2/pack.mrpack']);
  });

  it('maps the Modrinth API host under /modrinth', () => {
    expect(provider.injectUrl('https://api.modrinth.com/v2/project/example')).toBe(
      'https://mod.mcimirror.top/modrinth/v2/project/example'
    );
  });

  it('leaves official URLs without an additional fallback', () => {
    expect(provider.altUrls('https://piston-data.mojang.com/v1/objects/hash/client.jar')).toEqual([]);
  });

  it('honors a custom Modrinth mirror root', () => {
    const custom = new BmclapiDownloadProvider('https://bmclapi2.bangbang93.com', 'https://m.example.net');
    expect(custom.altUrls('https://cdn.modrinth.com/data/x/y.jar')).toEqual([
      'https://m.example.net/data/x/y.jar'
    ]);
  });
});

describe('MojangDownloadProvider', () => {
  it('passes URLs through unchanged', () => {
    const provider = new MojangDownloadProvider();
    expect(provider.injectUrl('https://piston-meta.mojang.com/x')).toBe(
      'https://piston-meta.mojang.com/x'
    );
    expect(provider.altUrls('https://cdn.modrinth.com/data/x/y.jar')).toEqual([]);
    expect(provider.concurrency).toBe(6);
  });
});

describe('createDownloadProvider', () => {
  it('collapses to one source when both settings agree', () => {
    const provider = createDownloadProvider({
      versionListSource: 'bmclapi',
      fileDownloadSource: 'bmclapi'
    });
    expect(provider.versionManifestUrl).toBe(
      `${BMCLAPI_ROOT}/mc/game/version_manifest_v2.json`
    );
    expect(provider.assetBaseUrl).toBe(`${BMCLAPI_ROOT}/assets/`);
  });

  it('takes the manifest from the list source and files from the file source', () => {
    const provider = createDownloadProvider({
      versionListSource: 'bmclapi',
      fileDownloadSource: 'mojang'
    });
    // The list came from the mirror…
    expect(provider.versionManifestUrl).toBe(
      `${BMCLAPI_ROOT}/mc/game/version_manifest_v2.json`
    );
    // …but the files did not, so nothing is rewritten and no fallback is offered.
    expect(provider.assetBaseUrl).toBe(MOJANG_URLS.assetBase);
    expect(provider.libraryBaseUrl).toBe(MOJANG_URLS.libraryBase);
    const jar = 'https://piston-data.mojang.com/v1/objects/abc/client.jar';
    expect(provider.injectUrl(jar)).toBe(jar);
    expect(provider.altUrls(jar)).toEqual([]);
    expect(provider.altUrls('https://cdn.modrinth.com/data/x/y.jar')).toEqual([]);
  });

  it('serves files from the mirror while the manifest stays official', () => {
    const provider = createDownloadProvider({
      versionListSource: 'mojang',
      fileDownloadSource: 'bmclapi'
    });
    expect(provider.versionManifestUrl).toBe(MOJANG_URLS.versionManifest);
    expect(provider.assetBaseUrl).toBe(`${BMCLAPI_ROOT}/assets/`);
    expect(
      provider.injectUrl('https://piston-data.mojang.com/v1/objects/abc/client.jar')
    ).toBe(`${BMCLAPI_ROOT}/v1/objects/abc/client.jar`);
  });

  it('follows the file source for the concurrency limit', () => {
    // Files come from Mojang here, whose fixed 6 must not be replaced by the
    // mirror's core-count-derived default.
    expect(
      createDownloadProvider({ versionListSource: 'bmclapi', fileDownloadSource: 'mojang' })
        .concurrency
    ).toBe(6);
  });

  it('lets an explicit thread count override both sources', () => {
    for (const fileDownloadSource of ['mojang', 'bmclapi'] as const) {
      expect(
        createDownloadProvider({
          versionListSource: 'mojang',
          fileDownloadSource,
          concurrency: 32
        }).concurrency
      ).toBe(32);
    }
  });

  it('passes a custom Modrinth mirror root through to the file source', () => {
    const provider = createDownloadProvider({
      versionListSource: 'mojang',
      fileDownloadSource: 'bmclapi',
      modrinthMirrorRoot: 'https://m.example.net'
    });
    expect(provider.altUrls('https://cdn.modrinth.com/data/x/y.jar')).toEqual([
      'https://m.example.net/data/x/y.jar'
    ]);
  });
});
