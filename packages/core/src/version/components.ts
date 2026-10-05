/**
 * Mod loader components an installed instance runs.
 *
 * HMCL walks the version manifest's libraries with a `GameComponentAnalyzer` and
 * prints what it finds on the instance list's second line
 * (`GameItem.java:106-118`): the game version, then every non-game component as
 * `Label` or `Label: version` when the manifest names a version for it. OptiFine
 * is deliberately absent there — it is a client-side patch, not a component, and
 * HMCL's filter has no `install.installer.optifine` key to print.
 */
import type { GameVersionJson } from './types.js';

/** One loader, as the instance list subtitle needs it. */
export interface LoaderComponent {
  /**
   * The Modrinth loader slug. A mod has to declare this to be considered
   * installable into an instance running the loader, so it is also what the
   * download page filters instances by.
   */
  slug: string;
  /** Display name, HMCL's `install.installer.<slug>`. */
  label: string;
  /**
   * The loader's own version, or `undefined` when the manifest carries no
   * library whose version coordinate is the loader's. NeoForge is the case that
   * matters: its version json ships only `net.neoforged:*` support libraries
   * (FML, JarJar, eventbus) and never a `net.neoforged:neoforge` artifact, so
   * there is no version to read. HMCL's subtitle omits the `: version` half in
   * exactly this case (`GameItem.java:114`), so we do too.
   */
  version: string | undefined;
}

/**
 * Artifacts that identify a loader, and the one whose version coordinate is the
 * loader version.
 *
 * `forge` needs several markers because the artifact was renamed when Forge
 * moved to the new FML: 1.20.1 ships `net.minecraftforge:forge:1.20.1-47.4.10`
 * while 1.21 ships `net.minecraftforge:fmlcore:1.21-51.0.33`. Older layouts
 * (pre-1.13 Forge, and every 1.13–1.20 install) only have `fmlloader`, so a
 * single-artifact rule would call those instances vanilla.
 */
interface LoaderSpec {
  label: string;
  /** `group` → accepted artifacts. `null` as the group accepts any artifact. */
  markers: Record<string, string[] | null>;
  /** Which marker's version coordinate holds the loader version. */
  versionMarker: string;
}

/**
 * Ordered: NeoForge is matched first because a NeoForge manifest still ships a
 * couple of `net.minecraftforge` artifacts (`srgutils`) and would otherwise be
 * called Forge.
 */
const LOADER_SPECS: Array<[string, LoaderSpec]> = [
  [
    'neoforge',
    {
      label: 'NeoForge',
      markers: { 'net.neoforged': null, 'net.neoforged.fancymodloader': null },
      versionMarker: 'neoforge'
    }
  ],
  [
    'forge',
    {
      label: 'Forge',
      markers: {
        'net.minecraftforge': ['forge', 'fmlcore', 'fmlloader']
      },
      versionMarker: 'fmlloader'
    }
  ],
  [
    'fabric',
    { label: 'Fabric', markers: { 'net.fabricmc': ['fabric-loader'] }, versionMarker: 'fabric-loader' }
  ],
  [
    'quilt',
    { label: 'Quilt', markers: { 'org.quiltmc': ['quilt-loader'] }, versionMarker: 'quilt-loader' }
  ],
  [
    'liteloader',
    { label: 'LiteLoader', markers: { 'com.mumfrey': ['liteloader'] }, versionMarker: 'liteloader' }
  ]
];

/**
 * The version a library declares, or `undefined` when the coordinate carries
 * none — `@jar` suffixed Maven coordinates and classifier-only entries do.
 */
function coordinateVersion(libraryName: string): string | undefined {
  const version = libraryName.split(':')[2];
  if (version === undefined || version === '' || version.includes('@')) return undefined;
  return version;
}

/**
 * Forge writes its loader version as `<mcVersion>-<loader>` inside the library
 * version coordinate (`1.20.1-47.4.10`), which reads as noise next to the game
 * version already printed at the head of the subtitle. Fabric and Quilt write a
 * bare version and are left alone.
 */
function stripGameVersionPrefix(version: string, gameVersion: string | undefined): string {
  if (gameVersion === undefined || gameVersion === '') return version;
  const prefix = `${gameVersion}-`;
  return version.startsWith(prefix) ? version.slice(prefix.length) : version;
}

/**
 * The loaders one library speaks for, as `[spec, version]` pairs — a library can
 * be a marker for more than one loader only in principle, so this stays a list
 * to keep the matching honest.
 */
function loadersOfLibrary(
  libraryName: string,
  gameVersion: string | undefined
): Array<{ slug: string; spec: LoaderSpec; version: string | undefined }> {
  const [group = '', artifact = ''] = libraryName.split(':');
  const version = coordinateVersion(libraryName);
  const found: Array<{ slug: string; spec: LoaderSpec; version: string | undefined }> = [];
  for (const [slug, spec] of LOADER_SPECS) {
    const accepted = spec.markers[group];
    if (accepted === undefined) continue;
    if (accepted !== null && !accepted.includes(artifact)) continue;
    const declared = artifact === spec.versionMarker ? version : undefined;
    found.push({
      slug,
      spec,
      version: declared === undefined ? undefined : stripGameVersionPrefix(declared, gameVersion)
    });
  }
  return found;
}

/**
 * The `inheritsFrom` chain from `id` up to the root vanilla version, in order.
 *
 * Ids already visited are skipped, so a manifest that points back at an
 * ancestor cannot loop forever.
 */
export function versionChain(
  id: string,
  manifests: ReadonlyMap<string, GameVersionJson>
): string[] {
  const chain: string[] = [];
  const seen = new Set<string>();
  let current: string | undefined = id;
  while (current !== undefined && current !== '' && !seen.has(current)) {
    seen.add(current);
    chain.push(current);
    current = manifests.get(current)?.inheritsFrom;
  }
  return chain;
}

/** The chain's manifests, dropping ids that have none on disk. */
export function chainManifests(
  id: string,
  manifests: ReadonlyMap<string, GameVersionJson>
): GameVersionJson[] {
  return versionChain(id, manifests)
    .map((versionId) => manifests.get(versionId))
    .filter((manifest): manifest is GameVersionJson => manifest !== undefined);
}

/** The root vanilla version an instance ends up running. */
export function rootGameVersion(
  id: string,
  manifests: ReadonlyMap<string, GameVersionJson>
): string {
  return versionChain(id, manifests).at(-1) ?? id;
}

/**
 * Every loader the `inheritsFrom` chain runs, most specific first.
 *
 * `chain` is ordered from the instance itself up to the root vanilla version, the
 * same order `resolveGameVersion` walks. A modpack like `ukuspvpmodpack` declares
 * no loader of its own and only reveals Fabric through the version it inherits
 * from, which is why the whole chain is read instead of just the instance.
 *
 * `gameVersion` is that root version id, used to strip the redundant prefix off
 * Forge's version coordinates.
 */
export function resolveLoaderComponents(
  chain: readonly GameVersionJson[],
  gameVersion: string | undefined
): LoaderComponent[] {
  const bySlug = new Map<string, LoaderComponent>();
  for (const manifest of chain) {
    for (const library of manifest.libraries ?? []) {
      for (const match of loadersOfLibrary(library.name ?? '', gameVersion)) {
        // The first marker found for a loader wins: the chain is walked from the
        // instance down, and the instance's own manifest is the one the user
        // installed, so it names the more relevant of two versions.
        const existing = bySlug.get(match.slug);
        if (existing === undefined) {
          bySlug.set(match.slug, {
            slug: match.slug,
            label: match.spec.label,
            version: match.version
          });
        } else if (existing.version === undefined && match.version !== undefined) {
          existing.version = match.version;
        }
      }
    }
  }
  return LOADER_SPECS.filter(([slug]) => bySlug.has(slug)).map(([slug]) => bySlug.get(slug)!);
}
