import { describe, expect, it } from 'vitest';
import { buildLaunchCommand, parseServerAddress } from './command.js';
import { GameRepository } from '../game/repository.js';
import type { ResolvedVersion } from '../version/resolve.js';
import { createOfflineProfile } from './auth.js';

const repo = new GameRepository('/games/.minecraft');

const vanilla: ResolvedVersion = {
  id: '1.20.1',
  mainClass: 'net.minecraft.client.main.Main',
  minecraftArguments:
    '--username ${auth_player_name} --version ${version_name} --gameDir ${game_directory} --assetsDir ${assets_root} --assetIndex ${assets_index_name} --uuid ${auth_uuid} --accessToken ${auth_access_token} --userType ${user_type}',
  arguments: undefined,
  jar: '1.20.1',
  assetIndexId: '8',
  assetIndexUrl: 'https://piston-meta.mojang.com/v1/packages/8/8.json',
  assets: '8',
  javaVersion: { component: 'java-runtime-gamma', majorVersion: 17 },
  type: 'release',
  libraries: [],
  downloads: undefined,
  logging: undefined
};

const auth = createOfflineProfile('Hero');
const baseOptions = {
  javaExecutable: '/usr/bin/java',
  javaMajorVersion: 17,
  gameDir: '/games/.minecraft'
};

describe('buildLaunchCommand', () => {
  it('places java first and mainClass after jvm args', () => {
    const command = buildLaunchCommand(repo, vanilla, auth, baseOptions);
    expect(command.argv[0]).toBe('/usr/bin/java');
    const mainIndex = command.argv.indexOf('net.minecraft.client.main.Main');
    expect(mainIndex).toBeGreaterThan(0);
    // Classpath flag pair must precede the main class.
    expect(command.argv.slice(0, mainIndex)).toContain('-cp');
  });

  it('substitutes legacy placeholders', () => {
    const command = buildLaunchCommand(repo, vanilla, auth, baseOptions);
    const joined = command.argv.join(' ');
    expect(joined).toContain(`--username Hero`);
    expect(joined).toContain('--version 1.20.1');
    expect(joined).toContain('--uuid ' + auth.uuid.replaceAll('-', ''));
    expect(joined).not.toContain('${auth_player_name}');
  });

  it('appends resolution args only when width/height are set', () => {
    const withResolution = buildLaunchCommand(repo, vanilla, auth, {
      ...baseOptions,
      width: 1280,
      height: 720
    });
    expect(withResolution.argv).toContain('--width');
    expect(withResolution.argv).toContain('1280');

    const withoutResolution = buildLaunchCommand(repo, vanilla, auth, baseOptions);
    expect(withoutResolution.argv).not.toContain('--width');
  });

  it('uses --server/--port below 1.20 and quick play on modern versions', () => {
    const legacyVersion: ResolvedVersion = { ...vanilla, id: '1.12.2' };
    const old = buildLaunchCommand(repo, legacyVersion, auth, {
      ...baseOptions,
      server: 'mc.example.com:25566'
    });
    expect(old.argv).toEqual(
      expect.arrayContaining(['--server', 'mc.example.com', '--port', '25566'])
    );

    const modern: ResolvedVersion = { ...vanilla, id: '1.20.4' };
    const quickPlay = buildLaunchCommand(repo, modern, auth, {
      ...baseOptions,
      server: 'mc.example.com'
    });
    expect(quickPlay.argv).toEqual(
      expect.arrayContaining(['--quickPlayMultiplayer', 'mc.example.com'])
    );
  });

  it('includes memory flags when configured', () => {
    const command = buildLaunchCommand(repo, vanilla, auth, {
      ...baseOptions,
      maxMemory: 4096,
      minMemory: 512
    });
    expect(command.argv).toContain('-Xmx4096m');
    expect(command.argv).toContain('-Xms512m');
  });

  it('throws when the main class is missing', () => {
    const broken: ResolvedVersion = { ...vanilla, mainClass: undefined };
    expect(() => buildLaunchCommand(repo, broken, auth, baseOptions)).toThrow(/Main class/);
  });
});

describe('parseServerAddress', () => {
  it('splits host and port', () => {
    expect(parseServerAddress('host:25565')).toEqual({ host: 'host', port: 25565 });
  });
  it('defaults the port to undefined', () => {
    expect(parseServerAddress('host')).toEqual({ host: 'host', port: undefined });
  });
});
