/**
 * `options.txt` handling, limited to what the resource pack switches need: the
 * `resourcePacks` and `incompatibleResourcePacks` lists the game reads when it
 * starts up. A pack that sits in the folder but is in neither list is never
 * loaded, which is why an installed pack can be invisible in game.
 *
 * Mirrors HMCL's `addon.resourcepack.ResourcePackManager`.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { compareVersions } from '../version/versionNumber.js';

/** An `options.txt` file, kept as ordered key→value pairs. */
export interface GameOptions {
  entries: Map<string, string>;
  /**
   * Encoding the file was read with. Minecraft has written options.txt as both
   * ISO-8859-1 and UTF-8 over the years, and rewriting a file in the other one
   * would mangle every non-ASCII pack name in it.
   */
  encoding: BufferEncoding;
}

/** The first game version that stores pack ids as `file/<name>`. */
const NEW_OPTIONS_FORMAT_RELEASE = '1.13';

/**
 * Whether a game version writes `file/<name>` instead of a bare file name.
 *
 * The format changed in 1.13 / 17w43a. Every release is compared directly; for
 * a snapshot the date-like id carries no comparable version, and every snapshot
 * that could still be installed here is from the 1.13 era or later.
 */
export function supportsNewOptionsFormat(gameVersion: string): boolean {
  if (/[A-Za-z]/.test(gameVersion)) return true;
  return compareVersions(gameVersion, NEW_OPTIONS_FORMAT_RELEASE) >= 0;
}

/**
 * Reads a game directory's options.txt; an empty set of entries when the file
 * is missing or unreadable, since a fresh instance has none yet.
 */
export async function readGameOptions(gameDir: string): Promise<GameOptions> {
  let bytes: Buffer;
  try {
    bytes = await readFile(join(gameDir, 'options.txt'));
  } catch {
    return { entries: new Map(), encoding: 'utf8' };
  }
  const encoding: BufferEncoding = isUtf8(bytes) ? 'utf8' : 'latin1';
  return { entries: parseOptions(bytes.toString(encoding)), encoding };
}

/** Serializes options back to the `key:value` form the game expects. */
export function serializeOptions(entries: ReadonlyMap<string, string>): string {
  let text = '';
  for (const [key, value] of entries) {
    text += `${key}:${value}${EOL}`;
  }
  return text;
}

/** Writes options back, creating the file when the instance had none. */
export async function writeGameOptions(gameDir: string, options: GameOptions): Promise<void> {
  await writeFile(join(gameDir, 'options.txt'), serializeOptions(options.entries), options.encoding);
}

/**
 * The resource packs the game loads, as file names with the `file/` prefix
 * stripped. Built-in ids such as `vanilla` are kept verbatim: they name no file
 * in the folder, so nothing in the listing can match them.
 */
export function enabledResourcePacks(entries: ReadonlyMap<string, string>): string[] {
  return parsePackList(entries.get('resourcePacks')).map(stripPackPrefix);
}

/**
 * Turns a pack on or off in the options, returning whether anything changed.
 *
 * Disabling also drops the pack from `incompatibleResourcePacks`: that list
 * only records packs the user deliberately kept enabled despite an incompatible
 * pack format, so a pack that is now off has no business being there.
 */
export function setResourcePackEnabled(
  entries: Map<string, string>,
  fileName: string,
  enabled: boolean,
  newFormat: boolean
): boolean {
  const packs = parsePackList(entries.get('resourcePacks'));
  const incompatible = parsePackList(entries.get('incompatibleResourcePacks'));
  const matches = (id: string): boolean => stripPackPrefix(id) === fileName;
  let packsModified = false;
  let incompatibleModified = false;

  if (enabled) {
    if (!packs.some(matches)) {
      packs.push(newFormat ? `file/${fileName}` : fileName);
      packsModified = true;
    }
  } else {
    const kept = packs.filter((id) => !matches(id));
    if (kept.length !== packs.length) {
      packs.length = 0;
      packs.push(...kept);
      packsModified = true;
    }
    const keptIncompatible = incompatible.filter((id) => !matches(id));
    if (keptIncompatible.length !== incompatible.length) {
      incompatible.length = 0;
      incompatible.push(...keptIncompatible);
      incompatibleModified = true;
    }
  }

  // Each list is written back only when it actually changed: emptying one has
  // to be written as `[]`, while leaving an untouched key alone keeps the file
  // byte-identical to what the game last wrote.
  if (packsModified) entries.set('resourcePacks', serializePackList(packs));
  if (incompatibleModified) {
    entries.set('incompatibleResourcePacks', serializePackList(incompatible));
  }
  return packsModified || incompatibleModified;
}

const EOL = '\n';

/** Parses the `key:value` lines, keeping the order the file was written in. */
function parseOptions(text: string): Map<string, string> {
  const entries = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    entries.set(line.slice(0, colon), line.slice(colon + 1));
  }
  return entries;
}

/** Parses a pack list, tolerating the `[]` an unconfigured instance has. */
function parsePackList(raw: string | undefined): string[] {
  if (raw === undefined || raw.trim() === '') return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string');
  } catch {
    // A corrupt list is replaced by an empty one rather than propagated: the
    // game would treat it as no packs enabled anyway.
    return [];
  }
}

function serializePackList(packs: readonly string[]): string {
  return JSON.stringify(packs);
}

function stripPackPrefix(id: string): string {
  return id.startsWith('file/') ? id.slice('file/'.length) : id;
}

function isUtf8(bytes: Buffer): boolean {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}
