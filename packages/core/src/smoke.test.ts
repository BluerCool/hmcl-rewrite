import { expect, it } from 'vitest';
import { MojangDownloadProvider } from './download/mirrors.js';
import { Downloader } from './download/downloader.js';
import { GameRepository } from './game/repository.js';
import { resolveVersion } from './version/resolve.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFile, rm } from 'node:fs/promises';

it('smoke: fetches remote manifest and resolves a real version', { timeout: 60_000 }, async () => {
  const provider = new MojangDownloadProvider();
  const response = await fetch(provider.versionManifestUrl);
  expect(response.ok).toBe(true);
  const manifest = (await response.json()) as {
    versions: { id: string; url: string; type: string }[];
  };
  expect(manifest.versions.length).toBeGreaterThan(100);

  const entry = manifest.versions.find((version) => version.id === '1.21')!;
  const repo = new GameRepository(mkdtempSync(join(tmpdir(), 'hmcl-smoke-')));
  try {
    const downloader = new Downloader({ concurrency: 4 });
    await downloader.downloadOne({
      url: provider.injectUrl(entry.url),
      destination: repo.versionJson('1.21')
    });
    const raw = JSON.parse(await readFile(repo.versionJson('1.21'), 'utf8'));
    const map = new Map([['1.21', raw]]);
    const resolved = resolveVersion('1.21', (id) => map.get(id));
    expect(resolved.mainClass).toContain('Main');
    expect(resolved.libraries.length).toBeGreaterThan(20);
    expect(resolved.assetIndexId).toBeTruthy();
    // Client download info must be present with a sha1.
    expect(resolved.downloads?.client?.sha1).toMatch(/^[0-9a-f]{40}$/);
  } finally {
    await rm(repo.rootDir, { recursive: true, force: true });
  }
});
