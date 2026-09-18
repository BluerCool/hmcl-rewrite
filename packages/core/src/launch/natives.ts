/**
 * Native library extraction, mirroring HMCL's `DefaultLauncher.decompressNatives`.
 */
import { mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { unzipSync } from 'fflate';
import { readFile, writeFile, rm } from 'node:fs/promises';
import type { ResolvedVersion } from '../version/resolve.js';
import type { GameRepository } from '../game/repository.js';

/**
 * Extracts every applicable native library of a resolved version into the
 * target directory.
 *
 * Skips directories, `.sha1`/`.git` files and entries excluded by the
 * library's `extract.exclude` prefixes. Files already present with equal
 * size are left untouched.
 *
 * @throws Error when reading or writing an archive fails
 */
export async function extractNatives(
  repo: GameRepository,
  version: ResolvedVersion,
  destination: string
): Promise<void> {
  await mkdir(destination, { recursive: true });

  for (const library of version.libraries) {
    if (!library.isNative()) continue;
    const jarPath = join(repo.librariesDir(), library.downloadInfo().path);
    let archive: Uint8Array;
    try {
      archive = await readFile(jarPath);
    } catch (error) {
      throw new Error(`Missing native library ${jarPath}`, { cause: error });
    }

    const files = unzipSync(archive);
    const exclude = library.extractExclude();
    for (const [entryName, data] of Object.entries(files)) {
      if (entryName.endsWith('/')) continue; // directory entry
      if (exclude.some((prefix) => entryName.startsWith(prefix))) continue;
      const baseName = entryName.slice(entryName.lastIndexOf('/') + 1);
      if (baseName.endsWith('.sha1') || baseName.endsWith('.git')) continue;

      const targetPath = join(destination, entryName);
      if (await sameSize(targetPath, data.length)) continue;
      await mkdir(join(targetPath, '..'), { recursive: true });
      await writeFile(targetPath, data);
    }
  }
}

/** Removes all regular files inside the natives directory. */
export async function cleanNativesDirectory(destination: string): Promise<void> {
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
}

async function sameSize(path: string, size: number): Promise<boolean> {
  try {
    return (await stat(path)).size === size;
  } catch {
    return false;
  }
}
