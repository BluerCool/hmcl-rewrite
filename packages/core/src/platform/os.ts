/**
 * Platform detection utilities mirroring HMCL's `OperatingSystem` /
 * `Architecture` enums.
 */

/** Operating systems recognized by the launcher. */
export type OS = 'windows' | 'linux' | 'macos' | 'freebsd';

/** CPU architectures recognized by the launcher. */
export type Arch = 'x86' | 'x86_64' | 'arm' | 'arm64';

/** The OS the launcher is currently running on. */
export const CURRENT_OS: OS = detectOS();

/** The architecture of the current process. */
export const CURRENT_ARCH: Arch = detectArch();

/** Mojang's name for each OS in library rules (`osx` for macOS). */
export function mojangOSName(os: OS): string {
  // FreeBSD libraries are served under the linux classifier in Mojang's repos.
  return os === 'macos' ? 'osx' : os === 'freebsd' ? 'linux' : os;
}

function detectOS(): OS {
  switch (process.platform) {
    case 'win32':
      return 'windows';
    case 'darwin':
      return 'macos';
    case 'freebsd':
    case 'openbsd':
    case 'netbsd':
      return 'freebsd';
    default:
      return 'linux';
  }
}

function detectArch(): Arch {
  switch (process.arch) {
    case 'ia32':
      return 'x86';
    case 'arm':
      return 'arm';
    case 'arm64':
      return 'arm64';
    default:
      return 'x86_64';
  }
}

/** Whether the given rule OS name matches the current environment. */
export function osNameMatches(name: string | undefined): boolean {
  if (name === undefined) return true;
  // Some modpacks write compound names such as "win-x86".
  if (name.includes('-')) {
    const [osPart, archPart] = name.split('-');
    return (
      osPart !== undefined &&
      mojangOSName(CURRENT_OS).startsWith(osPart) &&
      archMatchesLoose(archPart)
    );
  }
  const normalized = normalizeOSName(name);
  if (normalized === null) return true; // unknown names act as wildcards
  if (normalized === CURRENT_OS) return true;
  // Linux-family tolerance: freebsd may consume linux-classified natives.
  return normalized === 'linux' && CURRENT_OS === 'freebsd';
}

function archMatchesLoose(part: string | undefined): boolean {
  if (!part) return true;
  if (/^(32|i386|i686|x86)$/.test(part)) return CURRENT_ARCH === 'x86';
  if (/^(64|amd64|x86_64|x64)$/.test(part)) return CURRENT_ARCH === 'x86_64';
  if (/^aarch64$/.test(part)) return CURRENT_ARCH === 'arm64';
  if (/^arm$/.test(part)) return CURRENT_ARCH === 'arm';
  return false;
}

function normalizeOSName(name: string): OS | null {
  const lower = name.toLowerCase();
  if (lower.includes('win')) return 'windows';
  if (lower.includes('darwin') || lower.includes('osx') || lower.includes('mac')) return 'macos';
  if (lower.includes('freebsd') || lower.includes('openbsd') || lower.includes('netbsd')) return 'freebsd';
  if (lower.includes('linux') || lower.includes('nix') || lower.includes('nux')) return 'linux';
  return null;
}
