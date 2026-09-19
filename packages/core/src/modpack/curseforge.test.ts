import { expect, it, vi } from 'vitest';
import {
  curseForgeDirectUrl,
  curseForgeFileSegments,
  resolveCurseForgeFiles
} from './curseforge.js';

it('splits file ids into Edge CDN segments', () => {
  expect(curseForgeFileSegments(8901870)).toEqual([8901, 870]);
  expect(curseForgeFileSegments(3847103)).toEqual([3847, 103]);
  expect(curseForgeFileSegments(123)).toEqual([0, 123]);
});

it('builds the no-auth Edge CDN direct link', () => {
  expect(curseForgeDirectUrl(3847103, 'jei-1.18.2-9.7.0.209.jar')).toBe(
    'https://edge.forgecdn.net/files/3847/103/jei-1.18.2-9.7.0.209.jar'
  );
  expect(curseForgeDirectUrl(8901870, 'my mod.jar')).toBe(
    'https://edge.forgecdn.net/files/8901/870/my%20mod.jar'
  );
});

it('resolves files from the project document and falls back per file', async () => {
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (input: string | URL) => {
    const url = String(input);
    calls.push(url);
    return new Response(
      JSON.stringify({
        files: [{ id: 8901870, name: 'xaerominimap.jar', display: 'xaerominimap.jar', filesize: 42 }],
        download: { id: 8901870, name: 'xaerominimap.jar', display: 'xaerominimap.jar', filesize: 42 }
      }),
      { status: 200 }
    );
  });
  try {
    const out = await resolveCurseForgeFiles([
      { projectID: 263420, fileID: 8901870 },
      { projectID: 263420, fileID: 999999 }
    ]);
    expect(out[0]).toMatchObject({
      projectID: 263420,
      fileID: 8901870,
      filename: 'xaerominimap.jar',
      fileSize: 42
    });
    expect(out[1]).toBeUndefined();
    expect(calls.filter((url) => url.includes('?version='))).toEqual([
      'https://api.cfwidget.com/263420?version=999999'
    ]);
  } finally {
    vi.unstubAllGlobals();
  }
});

it('returns undefined for an unreachable project', async () => {
  vi.stubGlobal('fetch', async () => new Response('', { status: 500 }));
  try {
    const out = await resolveCurseForgeFiles([{ projectID: 1, fileID: 2 }]);
    expect(out[0]).toBeUndefined();
  } finally {
    vi.unstubAllGlobals();
  }
});