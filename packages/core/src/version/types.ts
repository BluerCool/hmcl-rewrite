/**
 * Raw JSON schema types for Minecraft version manifests, mirroring the
 * official launcher metadata format (and HMCL's tolerant parsing of it).
 */

/** A single rule entry inside a rules array. */
export interface RuleJson {
  action: 'allow' | 'disallow';
  os?: {
    name?: string;
    arch?: string;
    version?: string;
  };
  features?: Record<string, boolean>;
}

/**
 * An argument entry: either a plain string or a rule-gated value which may
 * expand to multiple tokens.
 */
export type ArgumentJson =
  | string
  | { rules?: RuleJson[]; value?: string | string[] };

export interface LibraryDownloadInfoJson {
  path?: string;
  url?: string;
  sha1?: string;
  size?: number;
}

export interface LibraryJson {
  name: string;
  url?: string;
  downloads?: {
    artifact?: LibraryDownloadInfoJson;
    classifiers?: Record<string, LibraryDownloadInfoJson>;
  };
  checksums?: string[];
  extract?: { exclude?: string[] };
  natives?: Record<string, string>;
  rules?: RuleJson[];
  hint?: string;
  filename?: string;
}

export interface AssetIndexRefJson {
  id: string;
  url: string;
  sha1?: string;
  size?: number;
  totalSize?: number;
}

export interface LoggingFileJson {
  id: string;
  url: string;
  sha1?: string;
  size?: number;
}

export interface LoggingJson {
  file?: LoggingFileJson;
  argument?: string;
  type?: string;
}

export interface ArgumentsJson {
  game?: ArgumentJson[] | undefined;
  jvm?: ArgumentJson[] | undefined;
}

/** The full version manifest JSON as stored in `versions/<id>/<id>.json`. */
export interface GameVersionJson {
  id: string;
  type?: string;
  time?: string;
  releaseTime?: string;
  inheritsFrom?: string;
  jar?: string;
  mainClass?: string;
  minecraftArguments?: string;
  arguments?: ArgumentsJson;
  assetIndex?: AssetIndexRefJson;
  assets?: string;
  complianceLevel?: number;
  javaVersion?: { component: string; majorVersion: number };
  libraries?: LibraryJson[];
  downloads?: Record<string, LibraryDownloadInfoJson>;
  logging?: Record<string, LoggingJson>;
  minimumLauncherVersion?: number;
  hidden?: boolean;
}

/** One entry of the remote version manifest. */
export interface RemoteVersionJson {
  id: string;
  type: string;
  url: string;
  time: string;
  releaseTime: string;
  sha1?: string;
  complianceLevel?: number;
}

/** The remote version manifest document. */
export interface VersionManifestJson {
  latest: { release?: string; snapshot?: string };
  versions: RemoteVersionJson[];
}
