import { spawn, type ChildProcess } from 'node:child_process';
import { describe, expect, it } from 'vitest';

import { stopProcess } from './stop.js';

/**
 * A stand-in for the game process.
 *
 * `ignoreTerm` is the case that separates asking from insisting: a client that
 * does not act on SIGTERM is exactly what HMCL's bare `process.destroy()`
 * leaves running forever. The process announces itself on stdout before doing
 * anything else, so a test never signals a JVM that has not finished booting —
 * an unstarted node still has its default SIGTERM handler in place and would
 * die of the polite request, which would make the stubborn case pass for the
 * wrong reason.
 */
function gameProcess(ignoreTerm: boolean): ChildProcess {
  const child = spawn(
    process.execPath,
    [
      '-e',
      [
        ignoreTerm ? "process.on('SIGTERM', () => {});" : '',
        'setInterval(() => {}, 1000);',
        "process.stdout.write('ready\\n');"
      ].join('')
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );
  return child;
}

/** Resolves once the process has installed its handlers and is idling. */
function ready(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    child.stdout?.once('data', () => resolve());
  });
}

/** Waits for the process to end, so a failing test does not leak it. */
function exitOf(child: ChildProcess): Promise<{ code: number | null; signal: string | null }> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }
  return new Promise((resolve) => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
}

describe('stopping a game', () => {
  it('asks politely first, so the client can save and close', async () => {
    const child = gameProcess(false);
    await ready(child);
    const ended = exitOf(child);
    await stopProcess(child, 10_000);
    expect(await ended).toEqual({ code: null, signal: 'SIGTERM' });
  });

  it('insists when the game ignores the first request', async () => {
    // HMCL only sends process.destroy() here, which leaves this case running
    // forever. That is the gap the second signal closes.
    const child = gameProcess(true);
    await ready(child);
    const ended = exitOf(child);
    await stopProcess(child, 100);
    expect(await ended).toEqual({ code: null, signal: 'SIGKILL' });
  });

  it('does not wait out the grace period for a game that complies', async () => {
    const child = gameProcess(false);
    await ready(child);
    const ended = exitOf(child);
    const started = Date.now();
    // A long grace proves the wait ends with the process, not with the timer.
    await stopProcess(child, 30_000);
    expect(await ended).toEqual({ code: null, signal: 'SIGTERM' });
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it('resolves at once for a process that already exited', async () => {
    const child = spawn(process.execPath, ['-e', 'process.exit(0);'], { stdio: 'ignore' });
    await exitOf(child);
    await expect(stopProcess(child, 30_000)).resolves.toBeUndefined();
  });

  it('takes a second call without a second signal', async () => {
    const child = gameProcess(true);
    await ready(child);
    const ended = exitOf(child);
    await Promise.all([stopProcess(child, 100), stopProcess(child, 100)]);
    expect(await ended).toEqual({ code: null, signal: 'SIGKILL' });
  });
});
