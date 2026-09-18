/**
 * Java runtime detection: scans conventional install locations and parses
 * `java -version` output — a simplified port of HMCL's java utilities.
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import { CURRENT_OS } from '../platform/os.js';

/** A detected Java installation. */
export interface JavaRuntime {
  /** Path of the `java` (or `java.exe`) executable. */
  readonly executable: string;
  /** Parsed major version (8, 11, 17, 21, ...). */
  readonly majorVersion: number;
  /** Raw version string as reported by the JVM. */
  readonly versionString: string;
}

/** Candidate root directories to scan for Java installations. */
export function candidateJavaHomes(): string[] {
  const homes = new Set<string>();
  if (process.env.JAVA_HOME !== undefined) homes.add(process.env.JAVA_HOME);

  switch (CURRENT_OS) {
    case 'windows': {
      const programFiles = [
        process.env['ProgramFiles'],
        process.env['ProgramFiles(x86)'],
        process.env['ProgramW6432']
      ];
      for (const base of programFiles) {
        if (base === undefined) continue;
        for (const vendor of ['Java', 'Eclipse Adoptium', 'Microsoft', 'Zulu', 'BellSoft']) {
          homes.add(join(base, vendor));
        }
      }
      break;
    }
    case 'macos':
      homes.add('/Library/Java/JavaVirtualMachines');
      break;
    default:
      homes.add('/usr/lib/jvm');
      homes.add(`${process.env.HOME ?? ''}/.jdks`.replace('~', process.env.HOME ?? ''));
      break;
  }
  return [...homes].filter((home) => home !== '' && existsSync(home));
}

/**
 * Scans candidate locations and returns every parseable Java runtime,
 * newest first.
 */
export async function detectJavaRuntimes(): Promise<JavaRuntime[]> {
  const executables: string[] = [];

  // A JAVA_HOME pointing directly at a JDK.
  for (const home of candidateJavaHomes()) {
    const direct = javaExecutableOf(home);
    if (direct !== undefined) executables.push(direct);
    let children;
    try {
      children = await readdir(home, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const child of children) {
      if (!child.isDirectory()) continue;
      const executable = javaExecutableOf(join(home, child.name));
      if (executable !== undefined) executables.push(executable);
    }
  }

  // Anything already on PATH.
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (dir === '') continue;
    const executable = javaExecutableOf(dir);
    if (executable !== undefined) executables.push(executable);
  }

  const runtimes = await Promise.all(
    [...new Set(executables)].map(async (executable) => inspectJava(executable))
  );
  return runtimes
    .filter((runtime): runtime is JavaRuntime => runtime !== null)
    .sort((a, b) => b.majorVersion - a.majorVersion);
}

function javaExecutableOf(dir: string): string | undefined {
  const suffix = CURRENT_OS === 'windows' ? 'java.exe' : 'java';
  const candidates =
    CURRENT_OS === 'macos'
      ? [join(dir, 'Contents', 'Home', 'bin', suffix), join(dir, 'bin', suffix)]
      : [join(dir, 'bin', suffix)];
  return candidates.find((candidate) => existsSync(candidate));
}

/** Runs `java -version` and parses the major version from stderr. */
export function inspectJava(executable: string): Promise<JavaRuntime | null> {
  return new Promise((resolve) => {
    execFile(executable, ['-version'], { timeout: 10_000 }, (error, _stdout, stderr) => {
      if (error !== null && error.code !== 0) {
        resolve(null);
        return;
      }
      const output = `${stderr}`;
      const match = /version "([^"]+)"/.exec(output);
      if (match === null) {
        resolve(null);
        return;
      }
      resolve({
        executable,
        majorVersion: parseMajorVersion(match[1]!),
        versionString: match[1]!
      });
    });
  });
}

/** Extracts the major version from strings like `1.8.0_392` or `21.0.1`. */
export function parseMajorVersion(versionString: string): number {
  const match = /^(\d+)(?:\.(\d+))?/.exec(versionString);
  if (match === null) return 0;
  const first = Number(match[1]);
  if (first === 1 && match[2] !== undefined) return Number(match[2]);
  return first;
}
