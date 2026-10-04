/**
 * Writing the launch command out as a runnable script.
 *
 * HMCL's `DefaultLauncher#makeLaunchScript` (HMCLCore, `:867-1020`) writes the
 * same command line the launcher would have spawned, wrapped in whatever the
 * host shell needs, so a user can start the game without the launcher running.
 * The three shapes are reproduced here argument for argument.
 */
import { basename } from 'node:path';
import { CURRENT_OS } from '../platform/os.js';

/** Which shell the script is written for, named after its file extension. */
export type ScriptFlavour = 'bat' | 'sh' | 'ps1';

/**
 * The extension a script gets when the user has not typed one, following
 * `Instances#getDefaultScriptExtension`: `.command` on macOS so Finder will run
 * it, `.bat` on Windows, `.sh` everywhere else.
 */
export function defaultScriptExtension(): 'bat' | 'command' | 'sh' {
  if (CURRENT_OS === 'windows') return 'bat';
  if (CURRENT_OS === 'macos') return 'command';
  return 'sh';
}

/** Picks the flavour to render, rejecting extensions the host cannot run. */
export function scriptFlavour(extension: string): ScriptFlavour {
  const lower = extension.toLowerCase().replace(/^\./, '');
  if (lower === 'ps1') return 'ps1';
  if (CURRENT_OS === 'windows') {
    if (lower === 'bat') return 'bat';
  } else if (lower === 'sh' || lower === 'bash' || lower === 'command') {
    return 'sh';
  }
  throw new Error(
    CURRENT_OS === 'windows'
      ? 'Windows 下启动脚本的扩展名必须是 .bat 或 .ps1'
      : '启动脚本的扩展名必须是 .sh、.bash、.ps1 或 .command'
  );
}

function containsAny(text: string, chars: string): boolean {
  return [...chars].some((char) => text.includes(char));
}

function escapeAll(text: string, chars: string): string {
  return [...chars].reduce((acc, char) => acc.replaceAll(char, `\\${char}`), text);
}

/** `CommandBuilder#toBatchStringLiteral`: quote only when a metachar is present. */
function batchLiteral(text: string): string {
  return containsAny(text, ' \t"^&<>|') ? `"${escapeAll(text, '\\"')}"` : text;
}

/** `CommandBuilder#toShellStringLiteral`, same shape with the shell's set. */
function shellLiteral(text: string): string {
  return containsAny(text, ' \t"!#$&\'()*,;<=>?[\\]^`{|}~')
    ? `"${escapeAll(text, '"$&`')}"`
    : text;
}

/** `CommandBuilder#pwshString`: single quotes, doubled to escape. */
function pwshLiteral(text: string): string {
  return `'${text.replaceAll("'", "''")}'`;
}

/**
 * The parent of a path, accepting either separator.
 *
 * `node:path`'s `dirname` is bound to the running platform, which would read a
 * Windows game directory as a single segment when this runs anywhere else; the
 * renderer is deliberately a pure function of its arguments so its output can
 * be checked for a platform it is not running on.
 */
function parentDir(path: string): string {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  if (cut < 0) return '.';
  const parent = path.slice(0, cut);
  // A drive root keeps the separator that ends it: the parent of `C:\w` is
  // `C:\`, not `C:`, which Windows would resolve to the current drive's
  // directory instead.
  if (/^[A-Za-z]:$/.test(parent)) return parent + path[cut];
  return parent === '' ? path.slice(0, 1) : parent;
}

/**
 * Renders the script body.
 *
 * `windows` decides line endings and the batch-only `pause`, exactly as HMCL's
 * `isWindows` local does; it is passed in rather than read from `CURRENT_OS` so
 * the renderer stays a pure function of its inputs.
 */
export function renderLaunchScript(
  argv: readonly string[],
  workingDirectory: string,
  flavour: ScriptFlavour,
  options: { preLaunchCommand?: string | undefined; windows?: boolean } = {}
): string {
  const windows = options.windows ?? CURRENT_OS === 'windows';
  const nl = windows ? '\r\n' : '\n';
  const lines: string[] = [];
  // HMCL points APPDATA at the parent of the game directory: Minecraft reads its
  // own options and log locations from there when it is started outside a
  // launcher, and the script has no launcher to fall back on.
  const appData = windows ? parentDir(workingDirectory) : undefined;

  if (flavour === 'ps1') {
    if (appData !== undefined) lines.push(`$Env:APPDATA=${pwshLiteral(appData)}`);
    lines.push(`Set-Location -LiteralPath ${pwshLiteral(workingDirectory)}`);
    if (options.preLaunchCommand !== undefined && options.preLaunchCommand.trim() !== '') {
      lines.push(preLaunchCommandLine(options.preLaunchCommand, pwshLiteral));
    }
    lines.push(['&', ...argv.map(pwshLiteral)].join(' '));
    return lines.join(nl) + nl;
  }

  if (flavour === 'bat') {
    lines.push('@echo off');
    if (appData !== undefined) lines.push(`set APPDATA=${appData}`);
    lines.push(`cd /D ${batchLiteral(workingDirectory)}`);
  } else {
    lines.push('#!/usr/bin/env bash');
    lines.push(`cd ${shellLiteral(workingDirectory)}`);
  }
  if (options.preLaunchCommand !== undefined && options.preLaunchCommand.trim() !== '') {
    lines.push(preLaunchCommandLine(options.preLaunchCommand, flavour === 'bat' ? batchLiteral : shellLiteral));
  }
  lines.push(argv.map(flavour === 'bat' ? batchLiteral : shellLiteral).join(' '));
  // A double-clicked .bat window closes the instant the game exits, taking the
  // log with it, so HMCL holds it open with a prompt.
  if (flavour === 'bat') lines.push('pause');
  return lines.join(nl) + nl;
}

/** Splits a user-typed pre-launch command on whitespace, honouring quotes. */
function preLaunchCommandLine(command: string, literal: (text: string) => string): string {
  return command
    .trim()
    .split(/\s+/)
    .filter((part) => part !== '')
    .map((part) => (/^["'].*["']$/.test(part) ? part : literal(part)))
    .join(' ');
}

/**
 * The bytes to write, including the UTF-8 BOM PowerShell needs on Windows to
 * read a script as UTF-8 rather than the ANSI code page.
 */
export function encodeLaunchScript(text: string, flavour: ScriptFlavour, windows: boolean): Buffer {
  if (flavour === 'ps1' && windows) {
    return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, 'utf8')]);
  }
  return Buffer.from(text, flavour === 'bat' ? 'latin1' : 'utf8');
}

/** The file name HMCL would suggest: the instance id with the right extension. */
export function suggestScriptName(instanceId: string): string {
  return `${basename(instanceId)}.${defaultScriptExtension()}`;
}
