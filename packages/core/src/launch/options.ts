/**
 * Launch options, a trimmed port of HMCL's `LaunchOptions` covering the
 * options relevant to the initial rewrite.
 */

/** All options are optional; absent fields fall back to sensible defaults. */
export interface LaunchOptions {
  /** Game data directory (`.minecraft`). Defaults to the repository root. */
  gameDir?: string;
  /** Path of the `java` executable used to run the game. */
  javaExecutable: string;
  /** Parsed major version of that JVM (8, 17, 21, ...). */
  javaMajorVersion: number;
  /** Maximum heap in MiB. */
  maxMemory?: number;
  /** Initial heap in MiB. */
  minMemory?: number;
  /** Initial window width; enables the custom-resolution feature flag. */
  width?: number;
  /** Initial window height. */
  height?: number;
  /** Launch the game in fullscreen. */
  fullscreen?: boolean;
  /** Join this server after launch (`host` or `host:port`). */
  server?: string;
  /** Extra JVM arguments appended before the classpath. */
  jvmArguments?: readonly string[];
  /** Extra game arguments appended at the end. */
  gameArguments?: readonly string[];
  /** Environment variables added to the game process. */
  environmentVariables?: Readonly<Record<string, string>>;
  /** Wrapper command prefix (e.g. `optirun`). */
  wrapper?: string;
  /** Prepend `nice -n <n>` on POSIX systems. */
  processPriority?: 'high' | 'above_normal' | 'normal' | 'below_normal' | 'low';
  /** Disable HMCL-generated optimizing JVM arguments (G1GC tuning). */
  noGeneratedOptimizingJVMArgs?: boolean;
}
