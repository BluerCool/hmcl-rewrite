/**
 * Whether a resource pack can be loaded by a given game version.
 *
 * A downloaded pack sitting in `resourcepacks/` says nothing about whether the
 * game will use it: the client only loads packs whose declared format matches
 * its own, and silently refuses the others — they show up in the game's list
 * marked incompatible and never apply. Since Modrinth's own `game_versions` and
 * a pack's `pack.mcmeta` disagree in practice, the file itself is the only
 * trustworthy answer.
 *
 * The rules below mirror what the client does, in the order the client does
 * them: `pack_format` decides, `supported_formats` widens it, and the
 * `min_format`/`max_format` scheme that arrived in 1.21.9 is unreadable to
 * anything older.
 */
import { readFile } from 'node:fs/promises';
import { strFromU8, unzipSync } from 'fflate';
import { join } from 'node:path';

import type { GameRepository } from './repository.js';

/** What a pack declares about itself in `pack.mcmeta`. */
export interface PackMetadata {
  /** `pack_format`: the field every version up to 1.21.8 reads. */
  packFormat?: number;
  /** `supported_formats` as an object; understood from 1.20.3 on. */
  supportedFormats?: { minInclusive: number; maxInclusive: number };
  /** `min_format` / `max_format`, the 1.21.9+ scheme. */
  minFormat?: number;
  maxFormat?: number;
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
  if (typeof pack.pack_format === 'number') metadata.packFormat = pack.pack_format;
  const min = numberOf(pack.min_format);
  const max = numberOf(pack.max_format);
  if (min !== undefined) metadata.minFormat = min;
  if (max !== undefined) metadata.maxFormat = max;
  const supported = pack.supported_formats;
  if (typeof supported === 'object' && supported !== null && !Array.isArray(supported)) {
    const minInclusive = numberOf((supported as Record<string, unknown>).min_inclusive);
    const maxInclusive = numberOf((supported as Record<string, unknown>).max_inclusive);
    if (minInclusive !== undefined && maxInclusive !== undefined) {
      metadata.supportedFormats = { minInclusive, maxInclusive };
    }
  }
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

/**
 * Whether the game would load the pack. An unknown answer on either side counts
 * as loadable: claiming a pack is broken without being able to prove it would be
 * worse than staying quiet.
 */
export function isPackCompatible(
  metadata: PackMetadata | undefined,
  required: number | undefined
): boolean {
  if (metadata === undefined || required === undefined) return true;
  if (metadata.supportedFormats !== undefined) {
    const { minInclusive, maxInclusive } = metadata.supportedFormats;
    return required >= minInclusive && required <= maxInclusive;
  }
  if (metadata.packFormat === undefined) {
    // Only the 1.21.9+ min/max scheme: a client that needs a plain number
    // cannot parse the metadata at all.
    return false;
  }
  return metadata.packFormat === required;
}

/** One-line reason for the tooltip, or undefined when the pack looks fine. */
export function packCompatibilityNote(
  metadata: PackMetadata | undefined,
  required: number | undefined
): string | undefined {
  if (isPackCompatible(metadata, required)) return undefined;
  if (required === undefined) return '无法确定这个游戏版本需要的资源包格式';
  const declared =
    metadata?.supportedFormats !== undefined
      ? `${metadata.supportedFormats.minInclusive}~${metadata.supportedFormats.maxInclusive}`
      : metadata?.packFormat !== undefined
        ? String(metadata.packFormat)
        : metadata?.minFormat !== undefined
          ? `${metadata.minFormat}+（新版格式写法）`
          : '未知';
  return `这个包声明的格式 ${declared}，你的游戏需要 ${required}，游戏会拒绝加载它`;
}

/** Number of the instance the resource pack folder belongs to, for messages. */
export function describePackFormat(metadata: PackMetadata | undefined): string {
  if (metadata === undefined) return '未知';
  if (metadata.packFormat !== undefined) return String(metadata.packFormat);
  if (metadata.minFormat !== undefined) return `${metadata.minFormat}+`;
  return '未知';
}

/** Convenience: the game directory's jar for a version, kept for callers. */
export function versionJarOf(repo: GameRepository, versionId: string): string {
  return join(repo.versionJar(versionId));
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
