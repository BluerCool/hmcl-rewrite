import { describe, expect, it } from 'vitest';
import { createOfflineProfile, offlineUuid } from './auth.js';

describe('offlineUuid', () => {
  it('matches the vanilla MD5 v3 algorithm', () => {
    // Ground truth: MD5("OfflinePlayer:Hero") with v3/variant bits set.
    expect(offlineUuid('Hero')).toBe('0e4aa515-47f1-30cf-8999-3e1faceff235');
  });

  it('is deterministic and name-dependent', () => {
    expect(offlineUuid('Alice')).toBe(offlineUuid('Alice'));
    expect(offlineUuid('Alice')).not.toBe(offlineUuid('Bob'));
  });
});

describe('createOfflineProfile', () => {
  it('produces a legacy profile with a canonical uuid', () => {
    const profile = createOfflineProfile('Hero');
    expect(profile.username).toBe('Hero');
    expect(profile.uuid).toBe(offlineUuid('Hero'));
    expect(profile.userType).toBe('legacy');
  });
});
