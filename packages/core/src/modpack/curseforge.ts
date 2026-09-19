/**
 * CurseForge modpack mod-file resolution.
 *
 * CurseForge modpacks pin mods as `{ projectID, fileID }` tuples; turning
 * those into downloadable files normally requires the CurseForge Core API,
 * which demands an API key we do not ship. Instead we resolve the file's
 * real upload name through the public CurseForge-widget mirror
 * (cfwidget.com) and construct the no-auth Edge CDN direct link
 * `https://edge.forgecdn.net/files/{f1}/{f2}/{name}`, where
 * `f1 = floor(fileID / 1000)` and `f2 = fileID % 1000`. The CDN serves the
 * file directly (a signed redirect) without any session.
 */
const CFWIDGET = 'https://api.cfwidget.com';
const EDGE = 'https://edge.forgecdn.net';
const CFWIDGET_HEADERS = { 'user-agent': 'HMCL-Rewrite/0.1.0' };

/** A CurseForge file pinned in a modpack manifest. */
export interface CurseForgeFileRef {
  readonly projectID: number;
  readonly fileID: number;
}

/** A resolvable CurseForge file plus its real upload name. */
export interface CurseForgeFileInfo extends CurseForgeFileRef {
  readonly filename: string;
  readonly fileSize: number | undefined;
}

/** Splits a file id into the Edge CDN path segments `[f1, f2]`. */
export function curseForgeFileSegments(fileID: number): [number, number] {
  return [Math.floor(fileID / 1000), fileID % 1000];
}

/** Constructs the no-auth Edge CDN direct link for a CurseForge file. */
export function curseForgeDirectUrl(fileID: number, filename: string): string {
  const [f1, f2] = curseForgeFileSegments(fileID);
  return `${EDGE}/files/${f1}/${f2}/${encodeURIComponent(filename)}`;
}

/**
 * Resolves CurseForge manifest files into direct-download metadata, probing
 * the public mirror once per project (cached, {@link limit} at a time) and
 * falling back to a precise per-file lookup when the pinned id is absent
 * from the recent-files list.
 *
 * @returns one entry per input file, `undefined` meaning unresolvable
 */
export async function resolveCurseForgeFiles(
  files: readonly CurseForgeFileRef[],
  limit = 4
): Promise<Array<CurseForgeFileInfo | undefined>> {
  const projects = new Map<number, Promise<CfWidgetProject | undefined>>();
  const project = (projectID: number): Promise<CfWidgetProject | undefined> => {
    let pending = projects.get(projectID);
    if (pending === undefined) {
      pending = fetchCurseProject(projectID);
      projects.set(projectID, pending);
    }
    return pending;
  };

  const infos: Array<CurseForgeFileInfo | undefined> = new Array(files.length);
  await mapWithConcurrency(files, limit, async (file, index) => {
    infos[index] = await resolveFile(project, file);
  });
  return infos;
}

async function resolveFile(
  project: (projectID: number) => Promise<CfWidgetProject | undefined>,
  file: CurseForgeFileRef
): Promise<CurseForgeFileInfo | undefined> {
  let payload = await project(file.projectID);

  let entry = payload?.files?.find((candidate) => candidate.id === file.fileID);
  if (entry === undefined && payload?.download?.id === file.fileID) {
    entry = payload.download;
  }
  if (entry === undefined) {
    // The pinned upload is not in the recent list; ask the mirror to single
    // it out by id.
    payload = await fetchCurseProject(file.projectID, file.fileID);
    entry = payload?.download?.id === file.fileID ? payload.download : undefined;
  }
  const filename = entry?.name ?? entry?.display;
  if (entry === undefined || filename === undefined || filename === '') {
    return undefined;
  }

  return {
    projectID: file.projectID,
    fileID: file.fileID,
    filename,
    fileSize: typeof entry.filesize === 'number' ? entry.filesize : undefined
  };
}

/** Minimal cfwidget JSON shape used here. */
interface CfWidgetProject {
  files?: Array<{ id?: number; name?: string; display?: string; filesize?: number }>;
  download?: { id?: number; name?: string; display?: string; filesize?: number };
}

/** Fetches the cfwidget project document, optionally pinned to one file. */
async function fetchCurseProject(
  projectID: number,
  fileID?: number
): Promise<CfWidgetProject | undefined> {
  const url = `${CFWIDGET}/${projectID}${fileID === undefined ? '' : `?version=${fileID}`}`;
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(url, {
        headers: CFWIDGET_HEADERS,
        signal: AbortSignal.timeout(30_000)
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = (await response.json()) as CfWidgetProject;
      if (payload === null || typeof payload !== 'object') {
        throw new Error('Malformed cfwidget payload');
      }
      return payload;
    } catch (error) {
      lastError = error;
      await delay(300 * (attempt + 1));
    }
  }
  return undefined;
}

/**
 * Runs `worker` over `items` with at most `limit` concurrent executions,
 * preserving input order via `index`.
 */
export async function mapWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>
): Promise<void> {
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor++;
        await worker(items[index]!, index);
      }
    })
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}