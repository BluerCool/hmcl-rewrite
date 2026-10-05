import { describe, expect, it } from 'vitest';
import {
  INSTANCE_ICON_TYPES,
  deriveInstanceIcon,
  instanceIconAsset,
  isAprilFools,
  isLegacySnapshot,
  isOldVersion,
  parseInstanceIconType
} from './icon.js';

const base = {
  setting: undefined,
  hasIconFile: false,
  loaders: [],
  hasOptiFine: false,
  gameVersion: '1.21.1'
} as const;

describe('deriveInstanceIcon', () => {
  it('follows computeIconImage: a picked icon outranks everything', () => {
    expect(
      deriveInstanceIcon({
        ...base,
        setting: 'CHEST',
        hasIconFile: true,
        loaders: ['fabric'],
        hasOptiFine: true,
        gameVersion: '13w02a'
      })
    ).toBe('CHEST');
  });

  it('ignores a setting that names no built-in icon', () => {
    // Older builds stored the icon's file name here, so a leftover value must
    // fall through to the derivation instead of blanking the icon.
    expect(deriveInstanceIcon({ ...base, setting: 'icon.png', loaders: ['forge'] })).toBe('FORGE');
  });

  it('gives a custom image file priority over the loader', () => {
    expect(deriveInstanceIcon({ ...base, hasIconFile: true, loaders: ['fabric'] })).toBe('GRASS');
  });

  it('picks the loader EnumSet order names first, not the order reported', () => {
    // getModLoaders() is an EnumSet<ModLoaderType>, so FORGE precedes
    // NEO_FORGE there and computeIconImage takes the first entry.
    expect(deriveInstanceIcon({ ...base, loaders: ['neoforge', 'forge'] })).toBe('FORGE');
    expect(deriveInstanceIcon({ ...base, loaders: ['fabric', 'quilt'] })).toBe('FABRIC');
    expect(deriveInstanceIcon({ ...base, loaders: ['liteloader', 'fabric'] })).toBe('FABRIC');
    expect(deriveInstanceIcon({ ...base, loaders: ['quilt'] })).toBe('QUILT');
    expect(deriveInstanceIcon({ ...base, loaders: ['cleanroom', 'quilt'] })).toBe('CLEANROOM');
  });

  it('maps LiteLoader to the chicken, as getIconType(ModLoaderType) does', () => {
    expect(deriveInstanceIcon({ ...base, loaders: ['liteloader'] })).toBe('CHICKEN');
  });

  it('falls back to OptiFine when no loader is present', () => {
    expect(deriveInstanceIcon({ ...base, hasOptiFine: true })).toBe('OPTIFINE');
  });

  it('prefers a loader over OptiFine', () => {
    expect(deriveInstanceIcon({ ...base, loaders: ['fabric'], hasOptiFine: true })).toBe('FABRIC');
  });

  it('recognises the April Fools snapshot HMCL names', () => {
    expect(deriveInstanceIcon({ ...base, gameVersion: '15w14a' })).toBe('APRIL_FOOLS');
    expect(deriveInstanceIcon({ ...base, gameVersion: '15w14a_unobfuscated' })).toBe('APRIL_FOOLS');
    expect(deriveInstanceIcon({ ...base, gameVersion: '1.RV-Pre1' })).toBe('APRIL_FOOLS');
  });

  it('gives other snapshots the command block', () => {
    expect(deriveInstanceIcon({ ...base, gameVersion: '13w02a' })).toBe('COMMAND');
  });

  it('gives pre-1.13 versions the crafting table', () => {
    expect(deriveInstanceIcon({ ...base, gameVersion: 'b1.7.3' })).toBe('CRAFT_TABLE');
    expect(deriveInstanceIcon({ ...base, gameVersion: 'rd-132211' })).toBe('CRAFT_TABLE');
  });

  it('gives a plain release the grass block', () => {
    expect(deriveInstanceIcon({ ...base, gameVersion: '1.21.1' })).toBe('GRASS');
    expect(deriveInstanceIcon({ ...base, gameVersion: undefined })).toBe('GRASS');
  });
});

describe('version predicates', () => {
  it('reads the legacy snapshot shape as YYwWWx', () => {
    expect(isLegacySnapshot('13w02a')).toBe(true);
    expect(isLegacySnapshot('13w02a_unobfuscated')).toBe(true);
    expect(isLegacySnapshot('1.21.1')).toBe(false);
    expect(isLegacySnapshot('23w31a')).toBe(true);
  });

  it('reads the pre-1.13 shapes', () => {
    for (const old of ['rd-132211', 'inf-20100618', 'in-20100101', 'a1.2.6', 'b1.7.3', 'c0.30']) {
      expect(isOldVersion(old)).toBe(true);
    }
    expect(isOldVersion('1.21.1')).toBe(false);
    expect(isOldVersion('fabric-loader-0.16.3-1.21.1')).toBe(false);
  });

  it('matches only the one April Fools snapshot HMCL spells out', () => {
    expect(isAprilFools('15w14a')).toBe(true);
    expect(isAprilFools('20w14∞')).toBe(false);
    expect(isAprilFools('1.21.1')).toBe(false);
    expect(isAprilFools('b1.7.3')).toBe(false);
  });
});

describe('the icon table', () => {
  it('offers the fourteen icons GameInstanceIconDialog offers', () => {
    expect(INSTANCE_ICON_TYPES.map((entry) => entry.id)).toEqual([
      'GRASS',
      'CHEST',
      'CHICKEN',
      'COMMAND',
      'APRIL_FOOLS',
      'OPTIFINE',
      'CRAFT_TABLE',
      'FABRIC',
      'LEGACY_FABRIC',
      'FORGE',
      'CLEANROOM',
      'NEO_FORGE',
      'FURNACE',
      'QUILT'
    ]);
  });

  it('gives every icon its own asset', () => {
    const assets = INSTANCE_ICON_TYPES.map((entry) => entry.asset);
    expect(new Set(assets).size).toBe(assets.length);
  });

  it('falls back to grass for an id it does not know', () => {
    expect(instanceIconAsset('CHEST')).toBe(INSTANCE_ICON_TYPES[1]!.asset);
    expect(instanceIconAsset('NOPE')).toBe(instanceIconAsset('GRASS'));
  });

  it('recognises only real ids', () => {
    expect(parseInstanceIconType('FURNACE')).toBe('FURNACE');
    expect(parseInstanceIconType('furnace')).toBeUndefined();
    expect(parseInstanceIconType(undefined)).toBeUndefined();
  });
});