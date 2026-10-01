/**
 * Whether a resource pack can be loaded by a given game version.
 *
 * A downloaded pack sitting in `resourcepacks/` says nothing about whether the
 * game will use it: the client loads only packs whose declared format covers its
 * own and refuses the rest, so they show up in the game's list marked
 * incompatible and never apply. Modrinth's `game_versions` and a pack's own
 * `pack.mcmeta` disagree often enough that the file is the only answer worth
 * trusting — "Low On Fire 1.21.3" declares 1.21.1 support, for instance, and its
 * metadata then rules it out.
 *
 * The rule below is HMCL's `ResourcePackManager.getResourcePackVersionRangeNew`
 * translated to numbers, including its details that decide real cases: both
 * spellings of `supported_formats` are read, a range reaching past 64 is thrown
 * away as nonsense, and `pack_format` has to fall inside the range the pack
 * claims rather than being taken at face value.
 */
import { readFile } from 'node:fs/promises';
import { strFromU8, unzipSync } from 'fflate';

import type { GameRepository } from './repository.js';

/**
 * Formats past this are not resource pack formats any released game used, so a
 * range that reaches beyond it is a pack author writing nonsense. HMCL draws the
 * same line, and it is what makes an array like `[0, 99]` unusable.
 */
const MAX_SANE_FORMAT = 64;

/** What a pack declares about itself in `pack.mcmeta`. */
export interface PackMetadata {
  /** `pack_format`: the field every version up to 1.21.8 reads. */
  packFormat?: number;
  /** `supported_formats`, in either the object or the two-element array form. */
  supportedFormats?: { min: number; max: number };
  /** `min_format` / `max_format`, the scheme that arrived in 1.21.9. */
  minFormat?: number;
  maxFormat?: number;
}

/** The formats a pack declares itself loadable by, if its claims hold up. */
export interface FormatRange {
  min: number;
  max: number;
}

/** Reads `pack.mcmeta` out of a pack zip. */
export async function readPackMetadata(zipPath: string): Promise<PackMetadata | undefined> {
  let raw: Uint8Array | undefined;
  try {
    const data = await readFile(zipPath);
    // Only the metadata is needed, so the rest of a 20 MB pack stays compressed.
    raw = unzipSync(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), {
      filter: (file) => file.name === 'pack.mcmeta'
    })['pack.mcmeta'];
  } catch {
    // Not a readable zip: the game will reject it too, and there is nothing to
    // say about it beyond that.
    return undefined;
  }
  if (raw === undefined) return undefined;

  let pack: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(strFromU8(raw));
    const section = (parsed as { pack?: unknown }).pack;
    if (typeof section !== 'object' || section === null) return undefined;
    pack = section as Record<string, unknown>;
  } catch {
    return undefined;
  }

  const metadata: PackMetadata = {};
  const packFormat = numberOf(pack.pack_format);
  if (packFormat !== undefined) metadata.packFormat = packFormat;
  const minFormat = numberOf(pack.min_format);
  if (minFormat !== undefined) metadata.minFormat = minFormat;
  const maxFormat = numberOf(pack.max_format);
  if (maxFormat !== undefined) metadata.maxFormat = maxFormat;
  const supported = readSupportedFormats(pack.supported_formats);
  if (supported !== undefined) metadata.supportedFormats = supported;
  return metadata;
}

/**
 * The resource pack format an installed game expects, read from the jar's
 * `version.json` the same way the game itself reports it.
 *
 * A mod or modpack instance has no jar of its own — it inherits one through
 * `inheritsFrom`, exactly like the game resolves it at launch — so the chain is
 * walked until a jar turns up. Undefined when none does, in which case no claim
 * is made about compatibility.
 */
export async function requiredResourceFormat(
  repo: GameRepository,
  versionId: string
): Promise<number | undefined> {
  const inheritsFrom = new Map(
    (await repo.listInstalledVersions()).map((version) => [version.id, version.manifest.inheritsFrom])
  );
  const seen = new Set<string>();
  let current: string | undefined = versionId;
  while (current !== undefined && !seen.has(current)) {
    seen.add(current);
    const format = await formatOfJar(repo.versionJar(current));
    if (format !== undefined) return format;
    current = inheritsFrom.get(current);
  }
  return undefined;
}

/**
 * The formats a pack accepts, or undefined when its own claims contradict each
 * other. Mirrors HMCL's `getResourcePackVersionRangeNew`: the 1.21.9 min/max
 * scheme has to agree with `supported_formats` and with `pack_format`, and the
 * older `pack_format` may not sit outside the range the pack declares.
 */
export function supportedFormatRange(metadata: PackMetadata | undefined): FormatRange | undefined {
  if (metadata === undefined) return undefined;
  const { packFormat, supportedFormats, minFormat, maxFormat } = metadata;

  if (minFormat === undefined || maxFormat === undefined) {
    // Old scheme: a single format, optionally widened by supported_formats.
    if (supportedFormats !== undefined) {
      if (supportedFormats.max > MAX_SANE_FORMAT) return undefined;
      if (packFormat === undefined) return undefined;
      if (packFormat < supportedFormats.min || packFormat > supportedFormats.max) return undefined;
      return supportedFormats;
    }
    if (packFormat === undefined || packFormat > MAX_SANE_FORMAT) return undefined;
    return { min: packFormat, max: packFormat };
  }

  // New scheme: 1.21.9+ pairs, which still have to agree with the old fields.
  if (minFormat > maxFormat) return undefined;
  if (minFormat > MAX_SANE_FORMAT) {
    if (supportedFormats !== undefined) return undefined;
    if (packFormat !== undefined && (packFormat < minFormat || packFormat > maxFormat)) return undefined;
  } else {
    if (supportedFormats === undefined) return undefined;
    if (supportedFormats.min !== minFormat) return undefined;
    // A max of 64 is HMCL's "and everything above it" marker.
    if (supportedFormats.max !== maxFormat && supportedFormats.max !== MAX_SANE_FORMAT) return undefined;
    if (packFormat === undefined) return undefined;
    if (packFormat < minFormat || packFormat > maxFormat) return undefined;
  }
  return { min: minFormat, max: maxFormat };
}

/**
 * Whether the game would load the pack. An unknown answer on either side counts
 * as loadable: claiming a pack is broken without being able to prove it would be
 * worse than staying quiet.
 */
export function isPackCompatible(
  metadata: PackMetadata | undefined,
  required: number | undefined
): boolean {
  if (required === undefined) return true;
  const range = supportedFormatRange(metadata);
  if (range === undefined) return metadata !== undefined ? false : true;
  return required >= range.min && required <= range.max;
}

/** One-line reason for the tooltip, or undefined when the pack looks fine. */
export function packCompatibilityNote(
  metadata: PackMetadata | undefined,
  required: number | undefined
): string | undefined {
  if (isPackCompatible(metadata, required)) return undefined;
  if (required === undefined) return '无法确定这个游戏版本需要的资源包格式';
  if (metadata === undefined) {
    return `读不出这个包的 pack.mcmeta，你的游戏需要格式 ${required}，游戏会拒绝加载它`;
  }
  const range = supportedFormatRange(metadata);
  const declared = ((): string => {
    if (range !== undefined) {
      const span = range.min === range.max ? String(range.min) : `${range.min}~${range.max}`;
      // A range taken from min/max means the pack only speaks the 1.21.9
      // dialect, which is worth spelling out: it is why the numbers look odd.
      return metadata.packFormat === undefined ? `${span}（新版格式写法）` : span;
    }
    if (metadata.supportedFormats !== undefined) {
      return `${metadata.supportedFormats.min}~${metadata.supportedFormats.max}（声明与 pack_format 矛盾）`;
    }
    if (metadata.packFormat !== undefined) return `${metadata.packFormat}（不是有效的资源包格式）`;
    return '未知';
  })();
  return `这个包声明的格式 ${declared}，你的游戏需要 ${required}，游戏会拒绝加载它`;
}

/** `supported_formats` as written by packs in the wild: object or [min, max]. */
function readSupportedFormats(value: unknown): { min: number; max: number } | undefined {
  if (Array.isArray(value) && value.length === 2) {
    const min = numberOf(value[0]);
    const max = numberOf(value[1]);
    if (min !== undefined && max !== undefined) return { min, max };
    return undefined;
  }
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    const min = numberOf(record.min_inclusive);
    const max = numberOf(record.max_inclusive);
    if (min !== undefined && max !== undefined) return { min, max };
  }
  return undefined;
}

async function formatOfJar(jarPath: string): Promise<number | undefined> {
  let entries: Record<string, Uint8Array>;
  try {
    const data = await readFile(jarPath);
    entries = unzipSync(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), {
      filter: (file) => file.name === 'version.json'
    });
  } catch {
    return undefined;
  }
  const raw = entries['version.json'];
  if (raw === undefined) return undefined;
  try {
    const parsed = JSON.parse(strFromU8(raw)) as { pack_version?: Record<string, unknown> };
    const pack = parsed.pack_version;
    if (typeof pack !== 'object' || pack === null) return undefined;
    // 1.21.9 moved to major/minor pairs; the plain field is gone by then.
    return numberOf(pack.resource) ?? numberOf(pack.resource_major);
  } catch {
    return undefined;
  }
}

function numberOf(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  // Some packs write a single number where the newer scheme wants a
  // [major, minor] pair.
  if (Array.isArray(value) && typeof value[0] === 'number' && Number.isFinite(value[0])) {
    return value[0] as number;
  }
  return undefined;
}
