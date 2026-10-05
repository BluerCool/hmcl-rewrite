/**
 * Where an installed instance came from.
 *
 * The modpack installer keeps the manifest it was handed verbatim in the
 * instance's `version.json` under `modpackInfo` (`writeModpackVersionJson`), so
 * the origin survives without a side database. HMCL instead looks for a
 * `modpack.json` in the instance folder (`HMCLGameInstance#isModpack`); both
 * answer the same two questions the instance list asks — is this a modpack, and
 * which version of it is installed.
 *
 * Neither format names the project it came from — a Modrinth index carries no
 * project id, and a CurseForge zip does not either — so the installer writes
 * down what it knew at download time in `modpackOrigin` (`writeModpackVersionJson`).
 * That is what makes "install another version of this pack" possible; without it
 * a pack can only be re-fetched by hand.
 */
import type { GameVersionJson } from '../version/types.js';

/** A loader as the modpack formats spell it, ready for `dependencies`. */
export interface ModpackLoaderSource {
  /** Modrinth dependency key, e.g. `fabric-loader`. */
  key: 'fabric-loader' | 'forge' | 'neoforge' | 'quilt-loader';
  version: string;
}

/** The modpack an instance was installed from. */
export interface ModpackSource {
  /** Which of the two formats the installer recognised. */
  format: 'modrinth' | 'curseforge';
  name: string;
  version: string;
  summary: string | undefined;
  /** Declared Minecraft version, i.e. the base the pack was built on. */
  gameVersion: string | undefined;
  loader: ModpackLoaderSource | undefined;
  /**
   * Modrinth project id or slug, when the pack was downloaded rather than
   * imported from a local file. Absent for local imports and for CurseForge,
   * which exposes no project id.
   */
  projectId: string | undefined;
}

/** Modrinth dependency keys, in the order CurseForge names them. */
const LOADER_KEYS = ['fabric-loader', 'forge', 'neoforge', 'quilt-loader'] as const;

/**
 * CurseForge names a loader `<loader>-<version>` (`forge-47.2.0`) inside one
 * string, while Modrinth splits it into a dependency key and a version. Longer
 * prefixes come first because `neoforge-` also starts like `forge-`.
 */
const CURSEFORGE_LOADER_PREFIXES: Array<[string, ModpackLoaderSource['key']]> = [
  ['fabric-', 'fabric-loader'],
  ['neoforge-', 'neoforge'],
  ['quilt-', 'quilt-loader'],
  ['forge-', 'forge']
];

/** The modpack this instance was installed from, or `undefined` when it is not one. */
export function modpackSourceOf(manifest: GameVersionJson): ModpackSource | undefined {
  const info = manifest.modpackInfo;
  if (!isRecord(info)) return undefined;

  // CurseForge spells the pack version `version`; Modrinth spells it `versionId`
  // and additionally carries a human `name`. A manifest with neither is not
  // something we wrote, so treat it as no source rather than inventing a blank.
  const version = str(info.versionId) ?? str(info.version);
  if (version === undefined) return undefined;

  const name = str(info.name) ?? str(info.nameRaw) ?? str(info.title);
  const dependencies = isRecord(info.dependencies) ? info.dependencies : undefined;
  // CurseForge nests the game block, so both the Minecraft version and the
  // loader list live one level down from the manifest root.
  const minecraft = isRecord(info.minecraft) ? info.minecraft : undefined;

  const origin = manifest.modpackOrigin;
  return {
    format: dependencies === undefined ? 'curseforge' : 'modrinth',
    name: name ?? version,
    version,
    summary: str(info.summary),
    gameVersion: str(dependencies?.minecraft) ?? str(minecraft?.version),
    loader: dependencies === undefined
      ? curseForgeLoader(minecraft?.modLoaders)
      : modrinthLoader(dependencies),
    projectId: isRecord(origin) ? str(origin.projectId) : undefined
  };
}

function modrinthLoader(dependencies: Record<string, unknown>): ModpackLoaderSource | undefined {
  for (const key of LOADER_KEYS) {
    const value = str(dependencies[key]);
    if (value !== undefined) return { key, version: value };
  }
  return undefined;
}

function curseForgeLoader(raw: unknown): ModpackLoaderSource | undefined {
  if (!Array.isArray(raw)) return undefined;
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const id = str(entry.id);
    if (id === undefined) continue;
    const match = CURSEFORGE_LOADER_PREFIXES.find(([prefix]) => id.startsWith(prefix));
    if (match === undefined) continue;
    return { key: match[1], version: id.slice(match[0].length) };
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}
