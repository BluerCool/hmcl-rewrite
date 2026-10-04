import { describe, expect, it } from 'vitest';
import { encodeLaunchScript, renderLaunchScript, scriptFlavour, suggestScriptName } from './script.js';

const ARGV = ['/usr/bin/java', '-Xmx2G', '-Djava.library.path=/a b/natives', 'cpw.mods.Main', '--gameDir', '/home/me/Minecraft'];

describe('renderLaunchScript', () => {
  it('writes a bash script that cds into the game directory first', () => {
    const script = renderLaunchScript(ARGV, '/home/me/Minecraft', 'sh', { windows: false });
    expect(script.split('\n')).toEqual([
      '#!/usr/bin/env bash',
      'cd /home/me/Minecraft',
      '/usr/bin/java -Xmx2G "-Djava.library.path=/a b/natives" cpw.mods.Main --gameDir /home/me/Minecraft',
      ''
    ]);
  });

  it('quotes only arguments that carry a shell metacharacter', () => {
    const script = renderLaunchScript(['java', 'plain', 'two words'], '/w', 'sh', { windows: false });
    expect(script).toContain('java plain "two words"\n');
  });

  it('writes a bat file with echo off, CRLF lines and a pause', () => {
    const script = renderLaunchScript(ARGV, 'C:\\Games\\mc', 'bat', { windows: true });
    expect(script.split('\r\n')).toEqual([
      '@echo off',
      'set APPDATA=C:\\Games',
      'cd /D C:\\Games\\mc',
      ['/usr/bin/java', '-Xmx2G', '"-Djava.library.path=/a b/natives"', 'cpw.mods.Main', '--gameDir', '/home/me/Minecraft'].join(' '),
      'pause',
      ''
    ]);
  });

  it('escapes backslashes and quotes the batch way', () => {
    const script = renderLaunchScript(['java', '-Dx=a\\b"c'], 'C:\\w', 'bat', { windows: true });
    expect(script).toContain('"-Dx=a\\\\b\\"c"');
  });

  it('writes PowerShell with single-quoted literals and the call operator', () => {
    const script = renderLaunchScript(['C:\\java.exe', '--gameDir', "C:\\it's"], 'C:\\w', 'ps1', {
      windows: true
    });
    expect(script.split('\r\n')).toEqual([
      // The parent of `C:\w` is the drive root, which keeps its separator.
      "$Env:APPDATA='C:\\'",
      "Set-Location -LiteralPath 'C:\\w'",
      "& 'C:\\java.exe' '--gameDir' 'C:\\it''s'",
      ''
    ]);
  });

  it('puts a pre-launch command on its own line before the game', () => {
    const script = renderLaunchScript(['java', 'Main'], '/w', 'sh', {
      windows: false,
      preLaunchCommand: 'java -jar patch.jar'
    });
    expect(script.split('\n')[2]).toBe('java -jar patch.jar');
    expect(script.split('\n')[3]).toBe('java Main');
  });

  it('omits APPDATA and the pause on POSIX shells', () => {
    const script = renderLaunchScript(['java'], '/home/me/mc', 'sh', { windows: false });
    expect(script).not.toContain('APPDATA');
    expect(script).not.toContain('pause');
  });
});

describe('encodeLaunchScript', () => {
  it('adds a UTF-8 BOM only for PowerShell on Windows', () => {
    expect([...encodeLaunchScript('& x', 'ps1', true).subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect([...encodeLaunchScript('& x', 'ps1', false).subarray(0, 3)]).not.toEqual([0xef, 0xbb, 0xbf]);
  });
});

describe('scriptFlavour', () => {
  it('accepts every extension the host shell understands', () => {
    // The suite runs on Linux, where .bat is not runnable but .sh is.
    expect(scriptFlavour('.sh')).toBe('sh');
    expect(scriptFlavour('BASH')).toBe('sh');
    expect(scriptFlavour('.command')).toBe('sh');
    expect(scriptFlavour('ps1')).toBe('ps1');
  });

  it('rejects an extension the host cannot run', () => {
    expect(() => scriptFlavour('txt')).toThrow(/扩展名/);
  });
});

describe('suggestScriptName', () => {
  it('names the file after the instance', () => {
    expect(suggestScriptName('1.21.1')).toBe('1.21.1.sh');
  });
});