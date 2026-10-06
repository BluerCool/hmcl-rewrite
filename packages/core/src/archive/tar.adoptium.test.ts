import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { extractTarFile } from './tar';

/**
 * These download a real JDK from Adoptium, so they only run when explicitly
 * asked for: `HMCL_NETWORK_TESTS=1 npx vitest run tar.adoptium`.
 *
 * The rest of the suite proves the reader against archives GNU tar produced,
 * but nothing synthetic covers the parts of a Temurin tarball a fixture would
 * have to guess at: the symlinks under `bin/`, the 100 MB `lib/modules`, and
 * whether what comes out is actually a working `java`.
 */
const networked = process.env.HMCL_NETWORK_TESTS === '1';

interface AdoptiumAsset {
  readonly link: string;
  readonly checksum: string;
  readonly name: string;
  readonly size: number;
}

/** Asks Adoptium for the current JRE 21 build for this platform. */
async function jre21(): Promise<AdoptiumAsset> {
  const response = await fetch(
    'https://api.adoptium.net/v3/assets/latest/21/hotspot?architecture=x64&image_type=jre&os=linux&vendor=eclipse',
  );
  expect(response.ok).toBe(true);
  const assets = (await response.json()) as { binary: { package: AdoptiumAsset } }[];
  return assets[0]!.binary.package;
}

async function download(url: string, destination: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`download failed: ${response.status}`);
  await writeFile(destination, Buffer.from(await response.arrayBuffer()));
}

/**
 * `java -version` reports on stderr, so stdout comes back empty; a non-zero
 * status is what says the extract did not produce a runnable runtime.
 */
function runJava(home: string) {
  return spawnSync(join(home, 'bin', 'java'), ['-version'], { encoding: 'utf8' });
}

describe.skipIf(!networked)('a real Adoptium JDK', () => {
  let root = '';
  let archive = '';
  let home = '';

  afterAll(async () => {
    if (root !== '') await rm(root, { recursive: true, force: true }).catch(() => undefined);
  });

  /**
   * Downloads and extracts once for the whole block.
   *
   * The asset is ~50 MB and came down at well under a megabyte per second from
   * here, so each test refetching it cost minutes and made a flaky mirror look
   * like a broken extractor.
   */
  async function installed(): Promise<string> {
    if (home !== '') return home;
    root ??= await mkdtemp(join(tmpdir(), 'hmcl-adoptium-'));
    const asset = await jre21();
    archive = join(root, asset.name);
    await download(asset.link, archive);
    const out = join(root, 'java');
    await extractTarFile(archive, out);
    // Adoptium wraps everything in one top-level directory named after the
    // version, so the home has to be discovered rather than assumed.
    const [inner] = await readdir(out);
    home = join(out, inner!);
    return home;
  }

  it('verifies the download against the checksum the API publishes', async () => {
    const asset = await jre21();
    await installed();

    // The checksum is what makes a partial download detectable; without it a
    // truncated archive would extract to a Java that starts and then dies.
    expect((await stat(archive)).size).toBe(asset.size);
    expect(createHash('sha256').update(await readFile(archive)).digest('hex')).toBe(asset.checksum);
  }, 900_000);

  it('extracts a runtime whose bin/java runs', async () => {
    const tree = await installed();

    const binary = join(tree, 'bin', 'java');
    await access(binary);
    // The executable bit has to survive extraction or nothing below can run.
    expect((await stat(binary)).mode & 0o111).not.toBe(0);

    const result = runJava(tree);
    expect(result.status, result.error?.message).toBe(0);
    expect(result.stderr).toMatch(/21\./);
  }, 900_000);

  it('extracts a file large enough to need many read chunks intact', async () => {
    const tree = await installed();

    // `lib/modules` is the one entry big enough to need several copies through
    // the fixed-size buffer; a short read here yields a Java that cannot start.
    expect((await stat(join(tree, 'lib', 'modules'))).size).toBeGreaterThan(50 * 1024 * 1024);
    expect(runJava(tree).status).toBe(0);
  }, 900_000);
});