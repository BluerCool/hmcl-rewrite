/**
 * Version inheritance resolution, mirroring HMCL's
 * `DefaultGameRepositorySnapshot.resolve` and `uniqueLibraries`.
 */
import type { ArgumentsJson, GameVersionJson } from './types.js';
import { Library } from './library.js';
import { mergeArguments } from './arguments.js';
import { compareVersions } from './versionNumber.js';

/**
 * A fully resolved version: no `inheritsFrom` remains and libraries are
 * deduplicated.
 */
export interface ResolvedVersion {
  /** The requested version id (never the parent's). */
  readonly id: string;
  readonly mainClass: string | undefined;
  readonly minecraftArguments: string | undefined;
  readonly arguments: ArgumentsJson | undefined;
  /** Effective client jar version id (`jar` field or the id itself). */
  readonly jar: string | undefined;
  readonly assetIndexId: string | undefined;
  /** Absolute URL of the asset index document, when the manifest declares one. */
  readonly assetIndexUrl: string | undefined;
  readonly assets: string | undefined;
  readonly javaVersion: { component: string; majorVersion: number } | undefined;
  readonly type: string | undefined;
  readonly libraries: readonly Library[];
  readonly downloads: GameVersionJson['downloads'];
  readonly logging: GameVersionJson['logging'];
}

/**
 * Resolves a version manifest by recursively folding its `inheritsFrom`
 * chain with cycle detection, then deduplicating libraries.
 *
 * @param id      the version to resolve
 * @param lookup  resolves a version id to its raw manifest
 * @returns the resolved launch manifest
 * @throws Error when a referenced parent version is missing
 */
export function resolveVersion(
  id: string,
  lookup: (id: string) => GameVersionJson | undefined
): ResolvedVersion {
  const visited = new Set<string>();
  const merged = fold(id, lookup, visited);
  return {
    ...merged,
    jar: merged.jar ?? id,
    libraries: uniqueLibraries(merged.libraries)
  };
}

function fold(
  id: string,
  lookup: (id: string) => GameVersionJson | undefined,
  visited: Set<string>
): ResolvedVersion {
  if (!visited.add(id)) {
    // Cycle: degrade to self-contained rather than looping forever.
    throw new Error(`Cyclic version inheritance detected at "${id}"`);
  }
  const manifest = lookup(id);
  if (manifest === undefined) {
    throw new Error(`Missing version manifest for "${id}"`);
  }

  const parentId = manifest.inheritsFrom;
  let resolved: ResolvedVersion = {
    id,
    mainClass: manifest.mainClass,
    minecraftArguments: manifest.minecraftArguments,
    arguments: manifest.arguments,
    // Effective-jar semantics (HMCL): an explicit `jar` always wins; a node
    // without one inherits its parent's effective jar, and the deepest
    // ancestor defaults to its own id.
    jar: manifest.jar ?? (parentId === undefined ? id : undefined),
    // Same effective-value semantics as `jar`: only fall back to `legacy` at
    // the deepest ancestor so inherited versions pick up the parent's index.
    assetIndexId:
      manifest.assetIndex?.id ??
      manifest.assets ??
      (parentId === undefined ? 'legacy' : undefined),
    assetIndexUrl: manifest.assetIndex?.url,
    assets: manifest.assets,
    javaVersion: manifest.javaVersion,
    type: manifest.type,
    libraries: (manifest.libraries ?? []).map((json) => new Library(json)),
    downloads: manifest.downloads,
    logging: manifest.logging
  };

  if (parentId !== undefined) {
    const parent = fold(parentId, lookup, visited);
    resolved = mergeChildIntoParent(resolved, parent);
  }
  return resolved;
}

/**
 * Merges a child into an already-resolved parent. Scalar fields prefer the
 * child; argument lists concatenate (parent first); library lists
 * concatenate (child first, dedup happens later).
 */
export function mergeChildIntoParent(
  child: ResolvedVersion,
  parent: ResolvedVersion
): ResolvedVersion {
  return {
    id: child.id,
    mainClass: child.mainClass ?? parent.mainClass,
    minecraftArguments: child.minecraftArguments ?? parent.minecraftArguments,
    arguments: mergeArguments(parent.arguments, child.arguments),
    jar: child.jar ?? parent.jar,
    assetIndexId: child.assetIndexId ?? parent.assetIndexId,
    assetIndexUrl: child.assetIndexUrl ?? parent.assetIndexUrl,
    assets: child.assets ?? parent.assets,
    javaVersion: child.javaVersion ?? parent.javaVersion,
    type: child.type ?? parent.type,
    libraries: [...child.libraries, ...parent.libraries],
    downloads: child.downloads ?? parent.downloads,
    logging: child.logging ?? parent.logging
  };
}

/**
 * Deduplicates libraries by `group:artifact` + rules identity: higher
 * versions win; equal versions that are not equal objects (e.g. a jar vs
 * its natives variant) coexist.
 */
export function uniqueLibraries(libraries: readonly Library[]): Library[] {
  const result: Library[] = [];
  for (const lib of libraries) {
    const key = lib.dedupKey();
    const existingIndex = result.findIndex((other) => other.dedupKey() === key);
    if (existingIndex < 0) {
      result.push(lib);
      continue;
    }
    const existing = result[existingIndex]!;
    const cmp = compareVersions(lib.version, existing.version);
    if (cmp > 0) {
      result[existingIndex] = lib;
    } else if (cmp === 0 && !lib.equals(existing)) {
      // Same coordinates but different content (jar vs natives): keep both.
      result.push(lib);
    }
  }
  return result;
}
