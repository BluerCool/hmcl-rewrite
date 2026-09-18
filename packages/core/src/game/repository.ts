/**
 * Game repository: the `.minecraft`-style directory layout and version
 * scanning, mirroring HMCL's `DefaultGameRepository` family.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { GameVersionJson } from '../version/types.js';
import { resolveVersion, type ResolvedVersion } from '../version/resolve.js';

/** A locally installed version with its raw manifest. */
export interface InstalledVersion {
  /** Directory name under `versions/`; authoritative over JSON `id`. */
  readonly id: string;
  readonly manifest: GameVersionJson;
}

/** Path layout of a game repository rooted at a `.minecraft` directory. */
export class GameRepository {
  readonly rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
  }

  /** Directory holding one sub-directory per installed version. */
  versionsDir(): string {
    return join(this.rootDir, 'versions');
  }

  /** Root directory of a single version instance. */
  versionRoot(id: string): string {
    return join(this.versionsDir(), id);
  }

  /** The version manifest JSON path. */
  versionJson(id: string): string {
    return join(this.versionRoot(id), `${id}.json`);
  }

  /** The client jar path (`jar` redirection is applied by callers). */
  versionJar(id: string): string {
    return join(this.versionRoot(id), `${id}.jar`);
  }

  /**
   * Native library extraction directory, platform-suffixed so multiple
   * JVM architectures can coexist.
   */
  nativesDir(id: string, osName: string, archName: string): string {
    return join(this.versionRoot(id), `natives-${osName}-${archName}`);
  }

  /** Shared maven-layout libraries directory. */
  librariesDir(): string {
    return join(this.rootDir, 'libraries');
  }

  /** Assets root (indexes / objects / virtual). */
  assetsDir(): string {
    return join(this.rootDir, 'assets');
  }

  /** Path of an asset index document. */
  assetIndexFile(assetId: string): string {
    return join(this.assetsDir(), 'indexes', `${assetId}.json`);
  }

  /** Content-addressed path of an asset object. */
  assetObjectFile(hash: string): string {
    return join(this.assetsDir(), 'objects', hash.slice(0, 2), hash);
  }

  /** Virtual (pre-1.6) asset reconstruction directory. */
  virtualAssetsDir(assetId: string): string {
    return join(this.assetsDir(), 'virtual', assetId);
  }

  /** Log configuration object directory shared across instances. */
  logConfigsDir(): string {
    return join(this.assetsDir(), 'log_configs');
  }

  /**
   * Lists installed versions by scanning the `versions` directory for
   * `<name>/<name>.json` layouts.
   * Falls back to the single JSON inside a directory when the conventional
   * name is absent.
   */
  async listInstalledVersions(): Promise<InstalledVersion[]> {
    const result: InstalledVersion[] = [];
    let entries;
    try {
      entries = await readdir(this.versionsDir(), { withFileTypes: true });
    } catch {
      return result;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const jsonPath = this.versionJson(entry.name);
      let raw: string | undefined;
      try {
        raw = await readFile(jsonPath, 'utf8');
      } catch {
        raw = await findSoleJson(join(this.versionsDir(), entry.name));
        if (raw === undefined) continue;
      }
      try {
        const manifest = JSON.parse(raw) as GameVersionJson;
        // Directory name wins over the embedded id.
        result.push({ id: entry.name, manifest: { ...manifest, id: entry.name } });
      } catch {
        // Skip malformed manifests rather than failing the whole scan.
      }
    }
    return result;
  }

  /** Loads and resolves a version by id against installed manifests. */
  async resolveInstalledVersion(id: string): Promise<ResolvedVersion> {
    const installed = await this.listInstalledVersions();
    const map = new Map(installed.map((v) => [v.id, v.manifest]));
    return resolveVersion(id, (versionId) => map.get(versionId));
  }
}

async function findSoleJson(dir: string): Promise<string | undefined> {
  try {
    const files = await readdir(dir);
    const jsons = files.filter((f) => f.endsWith('.json'));
    if (jsons.length !== 1) return undefined;
    return await readFile(join(dir, jsons[0]!), 'utf8');
  } catch {
    return undefined;
  }
}
