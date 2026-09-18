/**
 * Library model mirroring HMCL's `Library`: maven coordinates, platform
 * rules, native classifier selection and download info resolution.
 */
import { CURRENT_ARCH, CURRENT_OS, mojangOSName } from '../platform/os.js';
import { rulesAllow } from './rules.js';
import { Artifact } from './artifact.js';
import type {
  LibraryDownloadInfoJson,
  LibraryJson,
  RuleJson
} from './types.js';

/** Resolved download target for a library artifact. */
export interface LibraryDownload {
  /** Repository-relative path (maven layout). */
  readonly path: string;
  /** Absolute source URL. */
  readonly url: string;
  /** Expected SHA-1 digest, when known. */
  readonly sha1: string | undefined;
  /** Expected size in bytes, when known. */
  readonly size: number | undefined;
}

/**
 * Candidate native classifier descriptors in evaluation order, matching
 * HMCL's `POSSIBLE_NATIVE_DESCRIPTORS`: `[natives-|native-|]<os>[-<arch>]`.
 */
function nativeClassifierCandidates(): string[] {
  const osName = mojangOSName(CURRENT_OS);
  const archKeys = ['', archKey(), bitness()];
  const variants = ['', 'native-', 'natives-'];
  const result: string[] = [];
  for (const variant of variants) {
    for (const key of archKeys) {
      const suffix = key === '' ? '' : `-${key}`;
      result.push(`${variant}${osName}${suffix}`);
    }
  }
  return result;
}

function archKey(): string {
  switch (CURRENT_ARCH) {
    case 'x86':
      return 'x86';
    case 'arm':
      return 'arm32';
    case 'arm64':
      return 'arm64';
    default:
      return 'x86_64';
  }
}

function bitness(): string {
  return CURRENT_ARCH === 'x86' || CURRENT_ARCH === 'arm' ? '32' : '64';
}

/** A versioned library with platform applicability and download metadata. */
export class Library {
  readonly artifact: Artifact;
  readonly json: LibraryJson;

  constructor(json: LibraryJson) {
    this.json = json;
    this.artifact = new Artifact(json.name);
  }

  get groupId(): string {
    return this.artifact.group;
  }

  get artifactId(): string {
    return this.artifact.name;
  }

  get version(): string {
    return this.artifact.version;
  }

  /** Whether this library applies to the current environment. */
  applies(features: Readonly<Record<string, boolean>> = {}): boolean {
    return rulesAllow(this.json.rules as RuleJson[] | undefined, features);
  }

  /**
   * Selects the native classifier for the current platform.
   *
   * Order: explicit artifact classifier → `natives` map (with `${arch}`
   * substitution) → keys of `downloads.classifiers` → undefined.
   */
  nativeClassifier(): string | undefined {
    if (this.artifact.classifier !== undefined) return this.artifact.classifier;

    const natives = this.json.natives;
    if (natives !== undefined) {
      for (const candidate of nativeClassifierCandidates()) {
        const value = natives[candidate];
        if (value !== undefined) {
          return value.replaceAll('${arch}', bitness());
        }
      }
    }

    const classifiers = this.json.downloads?.classifiers;
    if (classifiers !== undefined) {
      for (const candidate of nativeClassifierCandidates()) {
        if (classifiers[candidate] !== undefined) return candidate;
      }
    }
    return undefined;
  }

  /** Whether this library carries native binaries for the current platform. */
  isNative(): boolean {
    if (!this.applies()) return false;
    if (this.json.natives !== undefined && Object.keys(this.json.natives).length > 0) {
      return true;
    }
    const classifiers = this.json.downloads?.classifiers;
    if (classifiers !== undefined) {
      return Object.keys(classifiers).some((key) => key.startsWith('native'));
    }
    return false;
  }

  /** The extract exclusion prefixes for native jars. */
  extractExclude(): readonly string[] {
    return this.json.extract?.exclude ?? [];
  }

  /** Resolves the download target for this library on the current platform. */
  downloadInfo(): LibraryDownload {
    const classifier = this.nativeClassifier();
    const raw =
      classifier !== undefined
        ? this.json.downloads?.classifiers?.[classifier]
        : this.json.downloads?.artifact;

    if (raw !== undefined && raw.url !== undefined) {
      return {
        path: raw.path ?? this.defaultPath(classifier),
        url: raw.url,
        sha1: raw.sha1,
        size: raw.size
      };
    }

    // Fall back to constructing the URL from the repository base.
    const base = this.json.url ?? 'https://libraries.minecraft.net/';
    const path = this.defaultPath(classifier);
    return {
      path,
      url: joinUrl(base, path),
      sha1: raw?.sha1,
      size: raw?.size
    };
  }

  private defaultPath(classifier: string | undefined): string {
    if (classifier === undefined) return this.artifact.path;
    const withClassifier = new Artifact(
      this.artifact.group,
      this.artifact.name,
      this.artifact.version,
      classifier,
      this.artifact.extension
    );
    return withClassifier.path;
  }

  /**
   * Deduplication identity: group + artifact + serialized rules hash.
   * Libraries sharing this key are interchangeable except for version.
   */
  dedupKey(): string {
    return `${this.groupId}:${this.artifactId}:${hashRules(this.json.rules)}`;
  }

  equals(other: Library): boolean {
    return (
      this.artifact.descriptor === other.artifact.descriptor &&
      this.isNative() === other.isNative()
    );
  }
}

function hashRules(rules: RuleJson[] | undefined): string {
  return JSON.stringify(rules ?? null);
}

function joinUrl(base: string, path: string): string {
  return base.endsWith('/') ? base + path : `${base}/${path}`;
}

export type { LibraryDownloadInfoJson };
