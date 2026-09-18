/**
 * Argument evaluation mirroring HMCL's `Arguments`, `StringArgument` and
 * `RuledArgument`, including the vanilla default argument tables.
 */
import { rulesAllow } from './rules.js';
import type { ArgumentJson, ArgumentsJson, RuleJson } from './types.js';

/** Substitution table for `${key}` placeholders. */
export type PlaceholderMap = Readonly<Record<string, string>>;
/** Feature flags used by rule-gated arguments. */
export type FeatureMap = Readonly<Record<string, boolean>>;

/** Expands `${key}` placeholders; unknown keys are left as-is. */
export function interpolate(value: string, keys: PlaceholderMap): string {
  return value.replace(/\$\{(.*?)}/g, (match, key: string) => {
    // Support both `${name}`-style keys (HMCL convention) and bare names.
    return keys[match] ?? keys[key] ?? match;
  });
}

/**
 * Evaluates a list of argument entries into concrete command-line tokens.
 */
export function parseArguments(
  argumentsJson: readonly ArgumentJson[] | undefined,
  keys: PlaceholderMap,
  features: FeatureMap = {}
): string[] {
  if (argumentsJson === undefined) return [];
  const result: string[] = [];
  for (const entry of argumentsJson) {
    if (entry === null || entry === undefined) continue;
    if (typeof entry === 'string') {
      result.push(interpolate(entry, keys));
    } else {
      const values = entry.value ?? [];
      const valueList = typeof values === 'string' ? [values] : values;
      if (!rulesAllow(entry.rules as RuleJson[] | undefined, features)) continue;
      for (const value of valueList) {
        if (value !== null && value !== undefined) {
          result.push(interpolate(value, keys));
        }
      }
    }
  }
  return result;
}

/** Merges two argument sets by concatenating game and jvm lists (a then b). */
export function mergeArguments(
  a: ArgumentsJson | undefined,
  b: ArgumentsJson | undefined
): ArgumentsJson | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return {
    game:
      a.game === undefined && b.game === undefined
        ? undefined
        : [...(a.game ?? []), ...(b.game ?? [])],
    jvm:
      a.jvm === undefined && b.jvm === undefined
        ? undefined
        : [...(a.jvm ?? []), ...(b.jvm ?? [])]
  };
}

const WINDOWS_HEAP_DUMP =
  '-XX:HeapDumpPath=MojangTricksIntelDriversForPerformance_javaw.exe_minecraft.exe.heapdump';

/**
 * Vanilla default JVM arguments used when a version manifest predates the
 * structured `arguments.jvm` format.
 */
export function defaultJvmArguments(): ArgumentJson[] {
  return [
    {
      rules: [{ action: 'allow', os: { name: 'windows' } }],
      value: [WINDOWS_HEAP_DUMP]
    },
    {
      rules: [{ action: 'allow', os: { name: 'windows', version: '^10\\.' } }],
      value: ['-Dos.name=Windows 10', '-Dos.version=10.0']
    },
    '-Djava.library.path=${natives_directory}',
    '-Dminecraft.launcher.brand=${launcher_name}',
    '-Dminecraft.launcher.version=${launcher_version}',
    '-cp',
    '${classpath}'
  ];
}

/**
 * Vanilla default game arguments appended when the legacy
 * `minecraftArguments` string is present (resolution feature flag).
 */
export function defaultGameArguments(): ArgumentJson[] {
  return [
    {
      rules: [
        { action: 'allow', features: { has_custom_resolution: true } }
      ],
      value: ['--width', '${resolution_width}', '--height', '${resolution_height}']
    }
  ];
}
