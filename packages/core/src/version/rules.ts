/**
 * Compatibility rule evaluation, mirroring HMCL's `CompatibilityRule` and
 * `OSRestriction`.
 */
import { release as osRelease } from 'node:os';
import { CURRENT_ARCH, CURRENT_OS, mojangOSName, osNameMatches } from '../platform/os.js';
import type { RuleJson } from './types.js';

/**
 * Evaluates a rule list against the current environment.
 *
 * An empty/absent list allows. Otherwise the action of the *last* applicable
 * rule wins; if no rule applies the list disallows.
 */
export function rulesAllow(
  rules: readonly RuleJson[] | undefined,
  features: Readonly<Record<string, boolean>> = {}
): boolean {
  if (rules === undefined || rules.length === 0) return true;
  let action: 'allow' | 'disallow' | undefined;
  for (const rule of rules) {
    const applied = appliedAction(rule, features);
    if (applied !== undefined) action = applied;
  }
  return action === 'allow';
}

function appliedAction(
  rule: RuleJson,
  features: Readonly<Record<string, boolean>>
): 'allow' | 'disallow' | undefined {
  if (rule.os !== undefined && !osRestrictionAllows(rule.os)) return undefined;
  if (rule.features !== undefined) {
    for (const [key, expected] of Object.entries(rule.features)) {
      if (features[key] !== expected) return undefined;
    }
  }
  return rule.action;
}

function osRestrictionAllows(os: NonNullable<RuleJson['os']>): boolean {
  if (!osNameMatches(os.name)) return false;
  if (os.version !== undefined && !new RegExp(os.version).test(releaseVersion())) {
    return false;
  }
  if (os.arch !== undefined) {
    const archNames: Record<string, string> = {
      x86: 'x86',
      amd64: 'x86_64',
      x86_64: 'x86_64',
      arm: 'arm',
      aarch64: 'arm64',
      arm64: 'arm64'
    };
    const wanted = archNames[os.arch.toLowerCase()];
    if (wanted === undefined || wanted !== CURRENT_ARCH) return false;
  }
  return true;
}

let cachedRelease: string | undefined;

/** OS version string used by `os.version` regex restrictions (e.g. "10.0"). */
function releaseVersion(): string {
  cachedRelease ??= osRelease();
  return cachedRelease;
}

/** The Mojang OS name of the current platform (`windows` / `linux` / `osx`). */
export function currentMojangOS(): string {
  return mojangOSName(CURRENT_OS);
}
