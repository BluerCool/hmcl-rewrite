/**
 * Ending a game process — the counterpart of HMCL's `ManagedProcess.stop`, with
 * the one thing it leaves out: what to do when the process does not comply.
 */
import type { ChildProcess } from 'node:child_process';

/**
 * How long a game is left to shut itself down before it is killed outright.
 *
 * A client normally closes well inside this on SIGTERM, but not always: a world
 * save or an asset download can hold it up, and one that ignored the signal
 * outright would never stop at all.
 */
export const STOP_GRACE_MS = 5000;

/**
 * Ends a game the way closing its window would.
 *
 * SIGKILL alone would stop a client mid-save and lose the world; SIGTERM alone
 * leaves a hung client running forever. So the game is asked first and only
 * insisted with if the asking did not work — and even then, a game that exits on
 * its own in between is left alone rather than killed while it is still saving.
 *
 * Resolves once the process is gone, or at once if it has already exited.
 * Idempotent: a second call while one is pending costs nothing.
 */
export function stopProcess(child: ChildProcess, graceMs: number = STOP_GRACE_MS): Promise<void> {
  if (hasExited(child)) return Promise.resolve();
  return new Promise<void>((resolve) => {
    let insisted = false;
    const finish = (): void => {
      clearTimeout(timer);
      child.removeListener('exit', finish);
      resolve();
    };
    const timer = setTimeout(() => {
      if (insisted || hasExited(child)) return finish();
      insisted = true;
      child.kill('SIGKILL');
    }, graceMs);
    child.once('exit', finish);
    child.kill('SIGTERM');
  });
}

/** Whether the process is already gone, by code or by signal. */
function hasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}
