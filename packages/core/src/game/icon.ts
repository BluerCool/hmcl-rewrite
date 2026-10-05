/**
 * The icon an instance shows on the list.
 *
 * HMCL resolves it in `HMCLGameInstance#computeIconImage` and caches the result
 * weakly. The order matters and is reproduced exactly: an icon the user picked
 * outranks a custom image file, which outranks the icon of whatever mod loader
 * the instance runs, which outranks OptiFine, which outranks the shape of the
 * game version itself. `GameInstanceIconDialog` offers the same set in the same
 * order, so the picker and the derived icons agree on what "chicken" means.
 */

/** One built-in icon, as the picker offers it. */
export interface InstanceIconType {
  /**
   * Stored in the instance settings. HMCL writes its enum name here, so the
   * ids are the same strings and the two settings files stay comparable.
   */
  id: string;
  /** Renderer asset, relative to the window's root. */
  asset: string;
}

/**
 * HMCL's `GameInstanceIconType`, minus `DEFAULT` (which means "derive it"), in
 * `GameInstanceIconDialog`'s order. The renderer ships the `@2x` variants of
 * HMCL's own artwork, so a 32px icon stays sharp on a HiDPI display.
 */
export const INSTANCE_ICON_TYPES: readonly InstanceIconType[] = [
  { id: 'GRASS', asset: 'img/grass@2x.png' },
  { id: 'CHEST', asset: 'img/chest@2x.png' },
  { id: 'CHICKEN', asset: 'img/chicken@2x.png' },
  { id: 'COMMAND', asset: 'img/command@2x.png' },
  { id: 'APRIL_FOOLS', asset: 'img/april_fools@2x.png' },
  { id: 'OPTIFINE', asset: 'img/optifine@2x.png' },
  { id: 'CRAFT_TABLE', asset: 'img/craft_table@2x.png' },
  { id: 'FABRIC', asset: 'img/fabric@2x.png' },
  { id: 'LEGACY_FABRIC', asset: 'img/legacyfabric@2x.png' },
  { id: 'FORGE', asset: 'img/forge@2x.png' },
  { id: 'CLEANROOM', asset: 'img/cleanroom@2x.png' },
  { id: 'NEO_FORGE', asset: 'img/neoforge@2x.png' },
  { id: 'FURNACE', asset: 'img/furnace@2x.png' },
  { id: 'QUILT', asset: 'img/quilt@2x.png' }
];

/** What the derivation needs to know about one instance. */
export interface InstanceIconInput {
  /** The icon the user picked in the settings page, if any. */
  setting: string | undefined;
  /** Whether an `icon.<ext>` file sits in the instance root. */
  hasIconFile: boolean;
  /**
   * Loader slugs as `resolveLoaderComponents` reports them. Their order here
   * does not matter — see {@link LOADER_ICONS} — but their set does.
   */
  loaders: readonly string[];
  /** Whether the instance has OptiFine installed. */
  hasOptiFine: boolean;
  /** The vanilla version the instance ultimately runs. */
  gameVersion: string | undefined;
}

/**
 * The icon id for an instance, following `computeIconImage`'s order. Never
 * returns `undefined`: the last resort is grass, which is what a plain vanilla
 * instance gets in HMCL too.
 */
export function deriveInstanceIcon(input: InstanceIconInput): string {
  const picked = parseInstanceIconType(input.setting);
  if (picked !== undefined) return picked;
  // A custom image is not an id, so the caller shows the file instead; the
  // derivation still has to answer with something for callers that only want
  // the id, and grass is what HMCL's `GameInstanceIconType.DEFAULT` resolves to.
  if (input.hasIconFile) return 'GRASS';
  for (const [slug, icon] of LOADER_ICONS) {
    if (input.loaders.includes(slug)) return icon;
  }
  if (input.hasOptiFine) return 'OPTIFINE';
  const version = input.gameVersion;
  if (version === undefined) return 'GRASS';
  if (isAprilFools(version)) return 'APRIL_FOOLS';
  if (isLegacySnapshot(version)) return 'COMMAND';
  if (isOldVersion(version)) return 'CRAFT_TABLE';
  return 'GRASS';
}

/**
 * HMCL's `getIconType(ModLoaderType)`, keyed by loader slug. LiteLoader gets
 * the chicken; every other case is spelled out in that switch too.
 *
 * The iteration order is not incidental. `computeIconImage` writes
 *
 *     for (ModLoaderType modLoader : getModLoaders())
 *         return GameInstanceIconType.getIconType(modLoader).getIcon();
 *
 * with no `break`, so the icon is whichever loader `getModLoaders()` yields
 * first — and that returns an `EnumSet`, which iterates in declaration order:
 * forge, cleanroom, neoforge, fabric, quilt, lite_loader. Walking this list in
 * order reproduces that exactly, which matters because an instance can carry
 * markers for more than one loader: a NeoForge install still ships a couple of
 * `net.minecraftforge` artifacts, and HMCL gives it the Forge icon.
 *
 * A slug missing from this table is skipped rather than given the command
 * block, which is what HMCL's `default` branch would do. It cannot happen with
 * the loaders `resolveLoaderComponents` reports today; a new one would be an
 * oversight rather than a deliberate choice either way.
 */
const LOADER_ICONS: ReadonlyArray<readonly [slug: string, icon: string]> = [
  ['forge', 'FORGE'],
  ['cleanroom', 'CLEANROOM'],
  ['neoforge', 'NEO_FORGE'],
  ['fabric', 'FABRIC'],
  ['quilt', 'QUILT'],
  ['liteloader', 'CHICKEN']
];

/** The asset for an icon id, falling back to grass for an unknown one. */
export function instanceIconAsset(id: string): string {
  return INSTANCE_ICON_TYPES.find((entry) => entry.id === id)?.asset ?? grassAsset;
}

const grassAsset = INSTANCE_ICON_TYPES[0]!.asset;

/** The built-in icon an id names, or `undefined` when it names none. */
export function parseInstanceIconType(id: string | undefined): string | undefined {
  if (id === undefined) return undefined;
  return INSTANCE_ICON_TYPES.some((entry) => entry.id === id) ? id : undefined;
}

/** `YYwWWx`, e.g. `13w02a`. HMCL requires the `w` at index 2. */
export function isLegacySnapshot(version: string): boolean {
  return version.length >= 6 && version[2] === 'w' && /^\d\dw\d\d/.test(version);
}

/** `rd-132211`, `inf-20100618`, `a1.2.6`, `b1.7.3`, `c0.30`. */
export function isOldVersion(version: string): boolean {
  return /^(rd-|inf-|in-|[abc])\d/.test(version);
}

/** A dotted numeric version, the shape `Release.parse` accepts. */
function isRelease(version: string): boolean {
  return /^\d+(\.\d+)*([-+][0-9A-Za-z.+_-]*)?$/.test(version);
}

/**
 * Port of `GameVersionNumber#isAprilFools`.
 *
 * Two branches, both copied: a snapshot is an April Fools one only when it is
 * `15w14a` (Mojang has published an April Fools snapshot most years since, and
 * HMCL matches exactly one of them), and anything that is neither a release nor
 * an old version counts unless it looks like `1.x` or is `13w12~` — which leaves
 * `1.RV-Pre1`, the one exception HMCL spells out.
 */
export function isAprilFools(version: string): boolean {
  if (isLegacySnapshot(version)) {
    return stripSnapshotUnobfuscated(version) === '15w14a';
  }
  if (isRelease(version) || isOldVersion(version)) return false;
  const normalized = stripSnapshotUnobfuscated(version);
  return (
    (!normalized.startsWith('1.') && normalized !== '13w12~') || normalized === '1.RV-Pre1'
  );
}

/** HMCL accepts `13w02a_unobfuscated` and `13w02a Unobfuscated` as one version. */
function stripSnapshotUnobfuscated(version: string): string {
  return version.replace(/[_ ]?[Uu]nobfuscated$/, '');
}
