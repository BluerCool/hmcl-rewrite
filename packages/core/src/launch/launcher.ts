/**
 * Launch orchestration: verify files, extract natives, spawn the game and
 * stream its output — the counterpart of HMCL's `LauncherHelper` pipeline.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { Downloader, type DownloadEntry, type DownloadProgress } from '../download/downloader.js';
import type { DownloadProvider } from '../download/mirrors.js';
import type { GameRepository } from '../game/repository.js';
import { ensureAssetIndex, planAssetObjectDownloads } from '../game/assets.js';
import type { ResolvedVersion } from '../version/resolve.js';
import type { Library } from '../version/library.js';
import type { AuthInfo } from './auth.js';
import { buildLaunchCommand, type LaunchCommand } from './command.js';
import type { LaunchOptions } from './options.js';
import { cleanNativesDirectory, extractNatives } from './natives.js';

/** Lifecycle stages reported while preparing a launch. */
export type LaunchStage =
  | 'resolving'
  | 'downloading-libraries'
  | 'downloading-assets'
  | 'extracting-natives'
  | 'starting'
  | 'running'
  | 'exited';

/** Events emitted during a launch. */
export type LaunchEvent =
  | { type: 'stage'; stage: LaunchStage }
  | { type: 'download-progress'; progress: DownloadProgress }
  | { type: 'output'; line: string; isError: boolean }
  | { type: 'exit'; code: number | null };

/**
 * Prepares and launches a resolved version.
 *
 * The pipeline mirrors HMCL: resolve → download missing libraries and the
 * client jar → download the asset index and objects → extract natives →
 * spawn the JVM with log streaming.
 */
export class Launcher {
  private readonly repo: GameRepository;
  private readonly provider: DownloadProvider;

  constructor(repo: GameRepository, provider: DownloadProvider) {
    this.repo = repo;
    this.provider = provider;
  }

  /**
   * Ensures every file required to run `version` exists locally,
   * downloading what is missing.
   *
   * @returns library entries that were downloaded (for progress reporting)
   */
  async ensureGameFiles(
    version: ResolvedVersion,
    onProgress?: (progress: DownloadProgress) => void
  ): Promise<void> {
    const entries = await this.planLibraryDownloads(version);
    const downloader = new Downloader({
      concurrency: this.provider.concurrency,
      onProgress
    });
    if (entries.length > 0) {
      await downloader.downloadAll(entries);
    }

    // Asset index + objects.
    const index = await ensureAssetIndex(
      this.repo,
      version.assetIndexId ?? 'legacy',
      version.assetIndexUrl,
      this.provider
    );
    const assetEntries = await planAssetObjectDownloads(this.repo, index, this.provider);
    if (assetEntries.length > 0) {
      await new Downloader({
        concurrency: this.provider.concurrency,
        onProgress
      }).downloadAll(assetEntries);
    }
  }

  /** Builds download entries for missing libraries and the client jar. */
  async planLibraryDownloads(version: ResolvedVersion): Promise<DownloadEntry[]> {
    const entries: DownloadEntry[] = [];

    const jarId = version.jar ?? version.id;
    const clientDownload = version.downloads?.['client'];
    if (clientDownload?.url !== undefined) {
      entries.push({
        url: this.provider.injectUrl(clientDownload.url),
        destination: this.repo.versionJar(jarId),
        sha1: clientDownload.sha1,
        size: clientDownload.size,
        altUrls: [clientDownload.url]
      });
    }

    for (const library of version.libraries) {
      if (!library.applies()) continue;
      const info = library.downloadInfo();
      entries.push({
        url: this.provider.injectUrl(info.url),
        destination: join(this.repo.librariesDir(), info.path),
        sha1: info.sha1,
        size: info.size,
        altUrls: [info.url]
      });
    }
    return entries;
  }

  /**
   * Runs the full launch pipeline and returns the running process handle.
   * Output lines are delivered through `onEvent` until the game exits.
   */
  async launch(
    version: ResolvedVersion,
    auth: AuthInfo,
    options: LaunchOptions,
    onEvent: (event: LaunchEvent) => void
  ): Promise<LaunchCommand> {
    onEvent({ type: 'stage', stage: 'downloading-libraries' });
    await this.ensureGameFiles(version, (progress) =>
      onEvent({ type: 'download-progress', progress })
    );

    onEvent({ type: 'stage', stage: 'extracting-natives' });
    const command = buildLaunchCommand(this.repo, version, auth, options);
    await cleanNativesDirectory(command.nativesDirectory);
    await extractNatives(this.repo, version, command.nativesDirectory);

    onEvent({ type: 'stage', stage: 'starting' });
    const child = spawn(command.argv[0]!, command.argv.slice(1), {
      cwd: command.workingDirectory,
      env: {
        ...process.env,
        ...options.environmentVariables
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    onEvent({ type: 'stage', stage: 'running' });
    streamOutput(child, onEvent);
    child.once('exit', (code) => {
      onEvent({ type: 'stage', stage: 'exited' });
      onEvent({ type: 'exit', code });
    });

    return command;
  }
}

function streamOutput(child: ChildProcess, onEvent: (event: LaunchEvent) => void): void {
  for (const [stream, isError] of [
    [child.stdout, false],
    [child.stderr, true]
  ] as const) {
    if (stream === null) continue;
    const reader = createInterface({ input: stream });
    reader.on('line', (line) => onEvent({ type: 'output', line, isError }));
  }
}

export type { Library };
