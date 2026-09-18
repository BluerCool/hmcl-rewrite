import { describe, expect, it } from 'vitest';
import { neoForgeLine } from './neoforge.js';
import { optiFineLoaderId, optiFineVersionId, parseOptiFineLoaderId } from './optifine.js';

describe('neoForgeLine', () => {
  // Per https://docs.neoforged.net/docs/gettingstarted/versioning:
  // NeoForge major/minor mirror the Minecraft version without the leading "1.".
  it('maps MC 1.21 to line 21.0', () => {
    expect(neoForgeLine('1.21')).toBe('21.0');
  });

  it('maps MC 1.20.2 to line 20.2', () => {
    expect(neoForgeLine('1.20.2')).toBe('20.2');
  });

  it('keeps date-era versions verbatim', () => {
    expect(neoForgeLine('26.1.2')).toBe('26.1.2');
  });
});

describe('optifine ids', () => {
  it('round-trips type and patch', () => {
    const id = optiFineLoaderId({ type: 'HD_U_J1', patch: 'pre9', stable: false });
    expect(id).toBe('HD_U_J1/pre9');
    expect(parseOptiFineLoaderId(id)).toEqual({ type: 'HD_U_J1', patch: 'pre9' });
  });

  it('builds version ids with and without patch', () => {
    expect(optiFineVersionId('1.21', 'HD_U_J1', 'pre9')).toBe('1.21-OptiFine_HD_U_J1_pre9');
    expect(optiFineVersionId('1.21.4', 'HD_U_I7', '')).toBe('1.21.4-OptiFine_HD_U_I7');
  });
});
