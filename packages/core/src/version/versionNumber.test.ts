import { describe, expect, it } from 'vitest';
import { compareVersions } from './versionNumber.js';

describe('compareVersions', () => {
  it('compares numerically, not lexically', () => {
    expect(compareVersions('9.0', '17.0')).toBeLessThan(0);
    expect(compareVersions('1.20', '1.3')).toBeGreaterThan(0);
  });

  it('handles differing lengths', () => {
    expect(compareVersions('1.0', '1.0.1')).toBeLessThan(0);
    expect(compareVersions('9.7', '9.7')).toBe(0);
  });

  it('sorts numeric chunks before suffixes', () => {
    expect(compareVersions('1.0.0-beta', '1.0.0')).toBeLessThan(0);
  });
});
