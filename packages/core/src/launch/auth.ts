/**
 * Authentication models. Offline profiles follow the vanilla algorithm
 * exactly; Microsoft credentials are produced by {@link ../auth/microsoft.ts}.
 */
import { createHash, randomUUID } from 'node:crypto';

/** Credentials handed to the launch command builder. */
export interface AuthInfo {
  /** In-game player name. */
  readonly username: string;
  /** Player UUID (canonical hyphenated form). */
  readonly uuid: string;
  /** Session token; offline profiles use a placeholder. */
  readonly accessToken: string;
  /** `msa` for Microsoft accounts, `legacy` for offline. */
  readonly userType: string;
}

/** Creates an offline profile the same way the vanilla launcher does. */
export function createOfflineProfile(username: string): AuthInfo {
  return {
    username,
    uuid: offlineUuid(username),
    accessToken: randomUUID().replaceAll('-', ''),
    userType: 'legacy'
  };
}

/**
 * Derives the offline player UUID: MD5 (version 3) of
 * `OfflinePlayer:<name>`, exactly matching `UUID.nameUUIDFromBytes`.
 */
export function offlineUuid(username: string): string {
  const hash = createHash('md5').update(`OfflinePlayer:${username}`, 'utf8').digest();

  // Set version (3) and variant (IETF) bits per RFC 4122.
  hash[6] = (hash[6]! & 0x0f) | 0x30;
  hash[8] = (hash[8]! & 0x3f) | 0x80;

  const hex = hash.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32)
  ].join('-');
}
