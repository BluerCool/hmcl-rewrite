/**
 * Classifying game output into log4j levels, so the log window can filter and
 * colour rows the way HMCL's `Log4jLevel` does. HMCL gets levels straight from
 * log4j; we only see the merged stdout/stderr stream, so they are recovered
 * from the line text.
 */

/** Severity levels, in HMCL's `Log4jLevel` declaration order. */
export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';

/** Every level, most severe first, as the filter row needs (LogWindow.java:72). */
export const LOG_LEVELS: readonly LogLevel[] = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'];

const LEVEL_NAMES = new Map<string, LogLevel>(LOG_LEVELS.map((level) => [level.toUpperCase(), level]));

/**
 * GLFW and LWJGL abbreviate to a single letter in brackets (`[W][11:16:12] pw.conf`),
 * which is how a chunk of the game's stderr announces itself as warnings.
 */
const LEVEL_INITIALS = new Map<string, LogLevel>(
  (['f', 'e', 'w', 'i', 'd', 't'] as const).flatMap((letter, index) => {
    const level = LOG_LEVELS[index];
    return level === undefined ? [] : [[letter.toUpperCase(), level] as const];
  })
);

/** `[09:44:39] [Render thread/WARN]: ...` — the timestamped vanilla pattern. */
const TIMESTAMPED = /^\[\d{2}:\d{2}:\d{2}(?:[.,]\d+)?\]/;

/** A bare level word, for launchers and wrappers that omit the brackets. */
const LEVEL_ANYWHERE = /\b(FATAL|ERROR|WARN|INFO|DEBUG|TRACE)\b/i;

/** How much of a line is searched; real level markers always sit near the front. */
const HEAD_LENGTH = 200;

/**
 * Stack traces and wrapped exceptions arrive as their own lines with no prefix.
 * They belong to whatever level introduced them.
 */
export function isContinuation(line: string): boolean {
  return /^\s/.test(line) || /^(at |Caused by:|\.\.\. \d+ more)/.test(line);
}

/**
 * Recovers the level of one output line, or undefined when the text carries
 * none. `isError` is only a last resort: Minecraft prints WARN and ERROR rows on
 * stdout, so a bracket or word marker beats the stream the line arrived on.
 */
export function parseLogLevel(line: string, isError: boolean): LogLevel | undefined {
  if (line.trim() === '') return undefined;
  const head = line.slice(0, HEAD_LENGTH);

  // Vanilla writes `[Render thread/WARN]`, Forge writes `[main/INFO]` and may
  // add `[modid/]` after it, so the level is whatever follows the last slash in
  // any bracket near the front. Scanning every bracket also keeps a stray
  // `[FATAL]` in the message body from being read as the row's level.
  for (const match of head.matchAll(/\[([^\]]*)\]/g)) {
    const inner = match[1] ?? '';
    const slash = inner.lastIndexOf('/');
    const tail = (slash < 0 ? inner : inner.slice(slash + 1)).trim().toUpperCase();
    const level = LEVEL_NAMES.get(tail) ?? (tail.length === 1 ? LEVEL_INITIALS.get(tail) : undefined);
    if (level !== undefined) return level;
  }
  // A timestamped row always carries its level in a bracket, so trusting bare
  // words past this point would only misread ordinary prose.
  if (TIMESTAMPED.test(line)) return undefined;

  const bare = LEVEL_ANYWHERE.exec(head);
  const word = bare?.[1];
  return word === undefined ? (isError ? 'error' : undefined) : LEVEL_NAMES.get(word.toUpperCase());
}

/**
 * Tracks the level a run of lines belongs to. Continuations inherit, so a stack
 * trace under an ERROR row stays red instead of dropping back to grey.
 */
export class LogLevelTracker {
  private last: LogLevel = 'info';

  /** Level for `line`, remembering it for the continuations that follow. */
  next(line: string, isError: boolean): LogLevel {
    const parsed = isContinuation(line) ? undefined : parseLogLevel(line, isError);
    if (parsed !== undefined) this.last = parsed;
    return this.last;
  }

  /** Forgets the run, so the next launch does not inherit the previous level. */
  reset(): void {
    this.last = 'info';
  }
}