import { describe, expect, it } from 'vitest';
import { isContinuation, LogLevelTracker, parseLogLevel } from './log-line.js';

describe('parseLogLevel', () => {
  it('reads the level from the vanilla thread/LEVEL bracket', () => {
    expect(parseLogLevel('[09:44:39] [Render thread/WARN]: Shader rendertype_x missing', false)).toBe('warn');
    expect(parseLogLevel('[09:44:39] [Server thread/ERROR]: boom', false)).toBe('error');
    expect(parseLogLevel('[09:44:39] [main/INFO]: Loading', false)).toBe('info');
    expect(parseLogLevel('[09:44:39] [main/DEBUG]: tick', false)).toBe('debug');
    expect(parseLogLevel('[09:44:39] [main/FATAL]: dead', false)).toBe('fatal');
  });

  it('reads Forge rows that carry a third logger bracket', () => {
    expect(parseLogLevel('[09:44:39] [main/INFO] [minecraft/]: hello', false)).toBe('info');
    expect(parseLogLevel('[12:00:00] [main/WARN] [Forge/]: careful', false)).toBe('warn');
  });

  it('keeps the row level when the message body mentions another one', () => {
    expect(parseLogLevel('[09:44:39] [main/INFO] [STDOUT]: [ERROR] unrelated body', false)).toBe('info');
  });

  it('does not mistake ordinary prose for a level', () => {
    expect(parseLogLevel('Setting user: JasonBCatte', false)).toBeUndefined();
    expect(parseLogLevel('[09:44:39] [main/INFO]: debugme-1.2.3.jar loaded', false)).toBe('info');
    expect(parseLogLevel('Loading WARNINGs from disk', false)).toBeUndefined();
  });

  it('falls back to a bare level word when there is no timestamp', () => {
    expect(parseLogLevel('[main/INFO]: hi', false)).toBe('info');
    expect(parseLogLevel('ERROR: something broke', false)).toBe('error');
  });

  it('trusts the stream only when the text says nothing', () => {
    expect(parseLogLevel('Exception in thread "main"', true)).toBe('error');
    expect(parseLogLevel('Exception in thread "main"', false)).toBeUndefined();
    expect(parseLogLevel('Picked up JAVA_TOOL_OPTIONS: -Xmx4g', false)).toBeUndefined();
  });

  it('ignores blank lines', () => {
    expect(parseLogLevel('', false)).toBeUndefined();
    expect(parseLogLevel('   ', true)).toBeUndefined();
  });
});

describe('isContinuation', () => {
  it('recognises stack trace tails', () => {
    expect(isContinuation('\tat java.base/java.lang.Thread.run')).toBe(true);
    expect(isContinuation('Caused by: java.lang.NullPointerException')).toBe(true);
    expect(isContinuation('... 12 more')).toBe(true);
  });

  it('leaves real log rows alone', () => {
    expect(isContinuation('[09:44:39] [main/INFO]: Loading')).toBe(false);
  });
});

describe('LogLevelTracker', () => {
  it('defaults to info before anything is seen', () => {
    expect(new LogLevelTracker().next('plain launcher chatter', false)).toBe('info');
  });

  it('carries a level across the stack trace under it', () => {
    const tracker = new LogLevelTracker();
    expect(tracker.next('[09:44:39] [main/ERROR]: failed', false)).toBe('error');
    expect(tracker.next('\tat com.example.Mod.tick(Mod.java:42)', false)).toBe('error');
    expect(tracker.next('Caused by: java.lang.NullPointerException', false)).toBe('error');
    expect(tracker.next('[09:44:39] [main/INFO]: recovered', false)).toBe('info');
    expect(tracker.next('\tat com.example.Other.go(Other.java:7)', false)).toBe('info');
  });

  it('forgets the run on reset', () => {
    const tracker = new LogLevelTracker();
    tracker.next('[09:44:39] [main/FATAL]: dead', false);
    tracker.reset();
    expect(tracker.next('\tat com.example.Other.go(Other.java:7)', false)).toBe('info');
  });
});