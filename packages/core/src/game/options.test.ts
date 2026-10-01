import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  enabledResourcePacks,
  readGameOptions,
  serializeOptions,
  setResourcePackEnabled,
  supportsNewOptionsFormat,
  writeGameOptions
} from './options.js';

let gameDir: string;

beforeEach(async () => {
  gameDir = await mkdtemp(join(tmpdir(), 'hmcl-options-'));
});

afterEach(async () => {
  await rm(gameDir, { recursive: true, force: true });
});

async function writeOptionsText(text: string): Promise<void> {
  await writeFile(join(gameDir, 'options.txt'), text, 'utf8');
}

describe('supportsNewOptionsFormat', () => {
  it('treats 1.13 and later as the file/ form', () => {
    expect(supportsNewOptionsFormat('1.13')).toBe(true);
    expect(supportsNewOptionsFormat('1.21.1')).toBe(true);
  });

  it('treats 1.12 and earlier as the bare file name', () => {
    expect(supportsNewOptionsFormat('1.12.2')).toBe(false);
    expect(supportsNewOptionsFormat('1.7.10')).toBe(false);
  });
});

describe('reading options.txt', () => {
  it('returns nothing for an instance that has never been launched', async () => {
    const options = await readGameOptions(gameDir);
    expect(options.entries.size).toBe(0);
  });

  it('keeps values that themselves contain a colon', async () => {
    await writeOptionsText('server:mc.example.com:25565\nresourcePacks:["file/a.zip"]\n');
    const options = await readGameOptions(gameDir);
    expect(options.entries.get('server')).toBe('mc.example.com:25565');
  });

  it('reports the packs the game would load, with the prefix stripped', async () => {
    await writeOptionsText('resourcePacks:["vanilla","file/Fabulously Optimized.zip"]\n');
    expect(enabledResourcePacks((await readGameOptions(gameDir)).entries)).toEqual([
      'vanilla',
      'Fabulously Optimized.zip'
    ]);
  });

  it('reads a legacy bare-name list too', async () => {
    await writeOptionsText('resourcePacks:["vanilla","Old.zip"]\n');
    expect(enabledResourcePacks((await readGameOptions(gameDir)).entries)).toContain('Old.zip');
  });
});

describe('enabling and disabling a pack', () => {
  it('adds a disabled pack to the list', async () => {
    await writeOptionsText('resourcePacks:["vanilla"]\n');
    const options = await readGameOptions(gameDir);
    expect(setResourcePackEnabled(options.entries, 'Pack.zip', true, true)).toBe(true);
    expect(enabledResourcePacks(options.entries)).toEqual(['vanilla', 'Pack.zip']);
  });

  it('keeps every unrelated setting', async () => {
    await writeOptionsText('fov:70.0\nresourcePacks:[]\nlang:zh_cn\n');
    const options = await readGameOptions(gameDir);
    setResourcePackEnabled(options.entries, 'Pack.zip', true, true);
    await writeGameOptions(gameDir, options);
    const written = await readFile(join(gameDir, 'options.txt'), 'utf8');
    expect(written).toContain('fov:70.0');
    expect(written).toContain('lang:zh_cn');
  });

  it('writes the bare file name for a pre-1.13 instance', async () => {
    const options = await readGameOptions(gameDir);
    setResourcePackEnabled(options.entries, 'Pack.zip', true, false);
    expect(options.entries.get('resourcePacks')).toBe('["Pack.zip"]');
  });

  it('does not add the same pack twice', async () => {
    const options = await readGameOptions(gameDir);
    expect(setResourcePackEnabled(options.entries, 'Pack.zip', true, true)).toBe(true);
    expect(setResourcePackEnabled(options.entries, 'Pack.zip', true, true)).toBe(false);
    expect(enabledResourcePacks(options.entries)).toEqual(['Pack.zip']);
  });

  it('treats a bare-name entry as already enabled', async () => {
    const options = await readGameOptions(gameDir);
    options.entries.set('resourcePacks', '["Pack.zip"]');
    expect(setResourcePackEnabled(options.entries, 'Pack.zip', true, true)).toBe(false);
  });

  it('removes the pack from both list forms when disabling', async () => {
    await writeOptionsText('resourcePacks:["file/Pack.zip"]\nincompatibleResourcePacks:["file/Pack.zip"]\n');
    const options = await readGameOptions(gameDir);
    expect(setResourcePackEnabled(options.entries, 'Pack.zip', false, true)).toBe(true);
    expect(enabledResourcePacks(options.entries)).toEqual([]);
    expect(options.entries.get('incompatibleResourcePacks')).toBe('[]');
  });

  it('leaves other packs alone when disabling one', async () => {
    await writeOptionsText('resourcePacks:["vanilla","file/Keep.zip","file/Pack.zip"]\n');
    const options = await readGameOptions(gameDir);
    setResourcePackEnabled(options.entries, 'Pack.zip', false, true);
    expect(enabledResourcePacks(options.entries)).toEqual(['vanilla', 'Keep.zip']);
  });

  it('reports no change when disabling something that was never enabled', async () => {
    const options = await readGameOptions(gameDir);
    expect(setResourcePackEnabled(options.entries, 'Pack.zip', false, true)).toBe(false);
  });

  it('replaces a corrupt pack list instead of propagating it', async () => {
    await writeOptionsText('resourcePacks:not json\n');
    const options = await readGameOptions(gameDir);
    expect(enabledResourcePacks(options.entries)).toEqual([]);
    expect(setResourcePackEnabled(options.entries, 'Pack.zip', true, true)).toBe(true);
    expect(enabledResourcePacks(options.entries)).toEqual(['Pack.zip']);
  });
});

describe('the file the game will read back', () => {
  it('round-trips through the file unchanged apart from the pack list', async () => {
    // The launcher's real flow: edit in memory, save, re-read.
    await writeOptionsText('fov:70.0\nresourcePacks:[]\n');
    const options = await readGameOptions(gameDir);
    setResourcePackEnabled(options.entries, 'Pack.zip', true, true);
    await writeGameOptions(gameDir, options);
    const reread = await readGameOptions(gameDir);
    expect(enabledResourcePacks(reread.entries)).toEqual(['Pack.zip']);
    expect(reread.entries.get('fov')).toBe('70.0');
  });

  it('keeps a latin-1 file latin-1 so pack names survive', async () => {
    // A latin-1 options.txt carries bytes that are not valid UTF-8, which is how
    // the encoding is told apart from a modern one.
    await writeFile(
      join(gameDir, 'options.txt'),
      Buffer.from('resourcePacks:[]\nlang:français\n', 'latin1')
    );
    const options = await readGameOptions(gameDir);
    expect(options.encoding).toBe('latin1');
    setResourcePackEnabled(options.entries, 'Café.zip', true, true);
    await writeGameOptions(gameDir, options);
    const raw = await readFile(join(gameDir, 'options.txt'));
    expect(raw.toString('latin1')).toContain('file/Café.zip');
    // Still latin1: decoding as UTF-8 must fail the same way it did before.
    expect(() => new TextDecoder('utf-8', { fatal: true }).decode(raw)).toThrow();
  });

  it('writes every entry on its own line', () => {
    expect(serializeOptions(new Map([['a', '1'], ['b', '2']]))).toBe('a:1\nb:2\n');
  });
});
